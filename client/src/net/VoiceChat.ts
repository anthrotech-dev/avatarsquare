import {
  createLocalAudioTrack,
  type LocalAudioTrack,
  type LocalTrackPublication,
  type Participant,
  type RemoteAudioTrack,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
  type Room,
  RoomEvent,
  Track,
  type TrackPublication,
} from 'livekit-client'
import { mouthTarget, rmsFromTimeDomain, stepMouth, stepSpeakingHold } from '../avatar/lipsync'
import { loadMicDeviceId, loadNoiseGate } from '../state/voice'

/**
 * ボイスチャット。Room 1接続につき1インスタンス(NetClientが生成・破棄)。
 *
 * 空間定位はlivekit-clientのwebAudioMixに乗る:
 * SDKがattach()した要素をミュートしつつ MediaStreamSource → [PannerNode] →
 * GainNode → destination を接続するため、setWebAudioPlugins([panner])で
 * 距離減衰+左右パンを挿し、音量は setVolume(個別×マスター)で制御する。
 * 音声を鳴らすには必ずattach()が必要(呼ばないとWebAudio接続自体が走らない)。
 *
 * VC OFF中は音声トラックを購読しない(setSubscribed(false))ため
 * 「聞こえない」が保証され、帯域も使わない。
 *
 * 送信はノイズゲートを通す:
 * 生マイク → MediaStreamSource → gateGain(閾値未満で0) → MediaStreamDestination
 * を組み、ゲート済みトラックを公開する(閾値未満の音は相手に一切届かない)。
 * ゲートの開閉は発話中判定(speakingHold)と連動し、語尾が切れないようホールドする。
 * 生マイクは手元で保持し続けるため、ミュート中でも設定パネルのメーターは動く
 * (代わりにブラウザのマイク使用表示はVC参加中ずっと点く)。
 */

/** 距離減衰の設定。マップは±28m、2m以内は等倍、30mでも約10%残す */
const PANNER_REF_DISTANCE = 2
const PANNER_MAX_DISTANCE = 30
const PANNER_ROLLOFF = 0.9
/** パンナー・リスナー位置のスムージング時定数(秒)。位置ジッターによるノイズ防止 */
const POSITION_SMOOTHING = 0.05
/** 口の高さ。音源・リスナーとも地面より少し上に置く */
const VOICE_HEIGHT = 1.5

// AudioContextはモジュールシングルトン(Chromeの同時生成数上限と
// StrictMode二重マウント対策。Roomのdisconnectでもcloseされない)
let sharedContext: AudioContext | null = null

export function getVoiceAudioContext(): AudioContext {
  if (!sharedContext) sharedContext = new AudioContext()
  return sharedContext
}

/** リモート参加者のVC状態。offはマイク非公開(=VC不参加) */
export type PeerVoiceState = 'off' | 'on' | 'muted'

export interface VoiceChatCallbacks {
  /** リモート参加者のVC状態変化(マイクの公開/ミュートから導出) */
  onPeerVoiceChanged(id: string, state: PeerVoiceState): void
  /** ブラウザのautoplay制限で音声出力がブロックされた(クリックで復旧する) */
  onPlaybackBlocked(): void
}

/** リモート音声1本ぶんのWebAudio資材 */
interface VoiceEntry {
  track: RemoteAudioTrack
  panner: PannerNode
  element: HTMLMediaElement
}

export class VoiceChat {
  private readonly context = getVoiceAudioContext()
  private readonly entries = new Map<string, VoiceEntry>()
  private readonly playerVolumes = new Map<string, number>()
  private masterVolume = 1
  private _enabled = false
  private _micMuted = false
  private mouth = 0
  private speakingHold = 0
  private noiseGate = loadNoiseGate()
  /** 直近のマイクRMS(設定パネルのメーター用) */
  private level = 0
  // 送信経路: rawMic → micSource → gateGain → micDest(この出力を公開)
  private rawMic: LocalAudioTrack | null = null
  private micSource: MediaStreamAudioSourceNode | null = null
  private gateGain: GainNode | null = null
  private micDest: MediaStreamAudioDestinationNode | null = null
  private micPublication: LocalTrackPublication | null = null
  private analyser: AnalyserNode | null = null
  private analyserData: Uint8Array<ArrayBuffer> | null = null
  private listenerInitialized = false
  private recoverListener: (() => void) | null = null

  constructor(
    private readonly room: Room,
    private readonly callbacks: VoiceChatCallbacks,
  ) {
    room
      .on(RoomEvent.Connected, this.onConnected)
      .on(RoomEvent.TrackSubscribed, this.onTrackSubscribed)
      .on(RoomEvent.TrackUnsubscribed, this.onTrackUnsubscribed)
      .on(RoomEvent.TrackPublished, this.onTrackPublished)
      .on(RoomEvent.TrackUnpublished, this.onTrackUnpublished)
      .on(RoomEvent.TrackMuted, this.onTrackMuteChanged)
      .on(RoomEvent.TrackUnmuted, this.onTrackMuteChanged)
      .on(RoomEvent.ParticipantConnected, this.onParticipantConnected)
      .on(RoomEvent.ParticipantDisconnected, this.onParticipantDisconnected)
      .on(RoomEvent.AudioPlaybackStatusChanged, this.onAudioPlaybackChanged)
  }

  get enabled(): boolean {
    return this._enabled
  }

  get micMuted(): boolean {
    return this._micMuted
  }

  /**
   * 自分が発話中か(ローカルのマイク音量から即時判定)。
   * ActiveSpeakersChangedはSFU往復ぶん遅れるため、自分の表示にはこちらを使う。
   */
  get selfSpeaking(): boolean {
    return this.speakingHold > 0
  }

  /**
   * VCへの参加/離脱。onは必ずユーザー操作起点で呼ぶこと
   * (初回のマイク許可プロンプトとautoplay解除のため)。失敗はthrow。
   */
  async setEnabled(on: boolean): Promise<void> {
    if (on === this._enabled) return
    if (on) {
      // autoplay制限の解除を先に試みる(ユーザー操作起点のうちに)
      void this.context.resume().catch(() => {})
      void this.room.startAudio().catch(() => {})
      await this.setupMic()
      this._enabled = true
      this._micMuted = false
    } else {
      this._enabled = false
      this._micMuted = false
      await this.teardownMic(true)
    }
    this.syncSubscriptions()
  }

  /**
   * VC参加中のマイクミュート。公開トラックだけ止め、生マイクは動かしたままにする
   * (設定パネルのメーターがミュート中も動くように)。
   */
  async setMicMuted(muted: boolean): Promise<void> {
    if (!this._enabled || muted === this._micMuted || !this.micPublication) return
    if (muted) await this.micPublication.mute()
    else await this.micPublication.unmute()
    this._micMuted = muted
  }

  /** ノイズゲート閾値(RMS)。これ未満の音は口パク・発話判定・送信すべて無音扱い */
  setNoiseGate(gate: number): void {
    this.noiseGate = gate
  }

  /** 直近のマイク入力レベル(RMS)。VC未参加は0。設定パネルのメーター用 */
  micLevel(): number {
    return this.level
  }

  /** 個別音量(0〜1)。実効音量 = 個別 × マスター */
  setPlayerVolume(id: string, volume: number): void {
    this.playerVolumes.set(id, volume)
    const entry = this.entries.get(id)
    if (entry) this.applyVolume(id, entry)
  }

  setMasterVolume(volume: number): void {
    this.masterVolume = volume
    for (const [id, entry] of this.entries) this.applyVolume(id, entry)
  }

  /**
   * マイクデバイスを切り替える。falseなら失敗。
   * 公開しているのはゲート済みトラックなので、生マイクの差し替えだけで済む
   * (公開トラックはそのまま=リモートには何も起きない)。
   * VC未参加時は何もしない(次回のsetupMicがloadMicDeviceIdを読む)。
   */
  async switchMicDevice(deviceId: string): Promise<boolean> {
    if (!this._enabled || !this.gateGain || !this.analyser) return true
    let raw: LocalAudioTrack
    try {
      raw = await this.createRawMic(deviceId)
    } catch {
      return false
    }
    this.micSource?.disconnect()
    this.rawMic?.stop()
    this.rawMic = raw
    this.micSource = this.context.createMediaStreamSource(new MediaStream([raw.mediaStreamTrack]))
    this.micSource.connect(this.gateGain)
    this.micSource.connect(this.analyser)
    return true
  }

  /**
   * 毎フレーム呼ぶ。リスナー(自アバター)と各音源(リモートの表示位置)を
   * 更新し、自マイク音量から求めた口開き重み(0〜1)を返す。
   */
  update(
    delta: number,
    listener: { x: number; z: number },
    remotePositions: Iterable<[string, { x: number; y: number; z: number }]>,
  ): number {
    if (this._enabled) {
      this.updateListener(listener)
      for (const [id, pos] of remotePositions) {
        const entry = this.entries.get(id)
        if (entry) this.setPannerPosition(entry.panner, pos.x, pos.y + VOICE_HEIGHT, pos.z)
      }
    }

    // マイクレベルは常に測る(ミュート中も設定パネルのメーターを動かすため)
    let rms = 0
    if (this.analyser && this.analyserData) {
      this.analyser.getByteTimeDomainData(this.analyserData)
      rms = rmsFromTimeDomain(this.analyserData)
    }
    this.level = rms

    // 口パク・発話判定: ミュート・VC OFF時は0へ閉じる
    const target = this._enabled && !this._micMuted ? mouthTarget(rms, this.noiseGate) : 0
    this.mouth = stepMouth(this.mouth, target, delta)
    this.speakingHold = stepSpeakingHold(this.speakingHold, target > 0, delta)

    // 送信ゲート: 発話中判定と同じホールドで開閉(語尾切れ防止)。
    // 開きは速く(出だしを削らない)、閉じは短いフェードでプツッと切らない
    if (this.gateGain) {
      const open = this.speakingHold > 0
      this.gateGain.gain.setTargetAtTime(open ? 1 : 0, this.context.currentTime, open ? 0.01 : 0.05)
    }
    return this.mouth
  }

  dispose(): void {
    // 公開解除はroomのdisconnectに任せ、手元の資材だけ確実に手放す
    void this.teardownMic(false)
    for (const id of [...this.entries.keys()]) this.removeEntry(id)
    if (this.recoverListener) {
      window.removeEventListener('pointerdown', this.recoverListener)
      this.recoverListener = null
    }
    // AudioContextは共有シングルトンなのでcloseしない(再接続で使い回す)
  }

  // ---- Roomイベント ----

  /** 接続完了。入室前から公開済みのトラックはTrackPublishedが発火しないため走査する */
  private readonly onConnected = (): void => {
    this.syncSubscriptions()
    for (const participant of this.room.remoteParticipants.values()) {
      this.notifyPeerState(participant)
    }
  }

  private readonly onTrackSubscribed = (
    track: RemoteTrack,
    publication: RemoteTrackPublication,
    participant: RemoteParticipant,
  ): void => {
    if (track.kind !== Track.Kind.Audio) return
    // VC OFF中はattachしない(=鳴らさない)。購読自体も解除する
    if (!this._enabled) {
      publication.setSubscribed(false)
      return
    }
    this.setupEntry(participant.identity, track as RemoteAudioTrack)
  }

  private readonly onTrackUnsubscribed = (
    track: RemoteTrack,
    _publication: RemoteTrackPublication,
    participant: RemoteParticipant,
  ): void => {
    if (track.kind !== Track.Kind.Audio) return
    this.removeEntry(participant.identity)
  }

  private readonly onTrackPublished = (
    publication: RemoteTrackPublication,
    participant: RemoteParticipant,
  ): void => {
    if (publication.kind !== Track.Kind.Audio) return
    publication.setSubscribed(this._enabled)
    this.notifyPeerState(participant)
  }

  private readonly onTrackUnpublished = (
    publication: RemoteTrackPublication,
    participant: RemoteParticipant,
  ): void => {
    if (publication.kind !== Track.Kind.Audio) return
    this.notifyPeerState(participant)
  }

  private readonly onTrackMuteChanged = (
    publication: TrackPublication,
    participant: Participant,
  ): void => {
    // 自分のミュートはsetMicMutedが状態を持つ(ここではリモートのみ扱う)
    if (publication.kind !== Track.Kind.Audio) return
    if (participant === this.room.localParticipant) return
    this.notifyPeerState(participant)
  }

  private readonly onParticipantConnected = (participant: RemoteParticipant): void => {
    // 公開済みマイクを持って入室してくるケースに備えて同期する
    this.syncParticipantSubscriptions(participant)
    this.notifyPeerState(participant)
  }

  private readonly onParticipantDisconnected = (participant: RemoteParticipant): void => {
    this.removeEntry(participant.identity)
  }

  private readonly onAudioPlaybackChanged = (): void => {
    if (this.room.canPlaybackAudio || !this._enabled || this.recoverListener) return
    this.callbacks.onPlaybackBlocked()
    // 次のクリックで復旧を試みる(一度きり)
    this.recoverListener = () => {
      this.recoverListener = null
      void this.room.startAudio().catch(() => {})
    }
    window.addEventListener('pointerdown', this.recoverListener, { once: true })
  }

  // ---- 内部処理 ----

  /** 全リモート音声トラックの購読状態をVC ON/OFFに合わせる */
  private syncSubscriptions(): void {
    for (const participant of this.room.remoteParticipants.values()) {
      this.syncParticipantSubscriptions(participant)
    }
  }

  private syncParticipantSubscriptions(participant: RemoteParticipant): void {
    for (const publication of participant.audioTrackPublications.values()) {
      ;(publication as RemoteTrackPublication).setSubscribed(this._enabled)
      // 既に購読済みのトラックがあれば直接配線する(イベントが再発火しないため)
      const track = publication.track
      if (this._enabled && track && track.kind === Track.Kind.Audio) {
        this.setupEntry(participant.identity, track as RemoteAudioTrack)
      }
    }
  }

  /** マイク公開/ミュートから導出したVC状態を通知する */
  private notifyPeerState(participant: Participant): void {
    const publication = participant.getTrackPublication(Track.Source.Microphone)
    const state: PeerVoiceState = !publication ? 'off' : publication.isMuted ? 'muted' : 'on'
    this.callbacks.onPeerVoiceChanged(participant.identity, state)
  }

  /** リモート音声トラックにパンナーを挿してattachする */
  private setupEntry(id: string, track: RemoteAudioTrack): void {
    const existing = this.entries.get(id)
    if (existing?.track === track) return
    if (existing) this.removeEntry(id)

    const panner = this.context.createPanner()
    panner.panningModel = 'equalpower'
    panner.distanceModel = 'linear'
    panner.refDistance = PANNER_REF_DISTANCE
    panner.maxDistance = PANNER_MAX_DISTANCE
    panner.rolloffFactor = PANNER_ROLLOFF

    track.setWebAudioPlugins([panner])
    // attach必須: SDKはattach済み要素のstreamからWebAudioへ接続する
    // (要素自体はミュートされるためDOMに足す必要はない)
    const element = track.attach()
    const entry: VoiceEntry = { track, panner, element }
    this.entries.set(id, entry)
    this.applyVolume(id, entry)
  }

  private removeEntry(id: string): void {
    const entry = this.entries.get(id)
    if (!entry) return
    entry.track.detach(entry.element)
    entry.element.remove()
    this.entries.delete(id)
  }

  private applyVolume(id: string, entry: VoiceEntry): void {
    const personal = this.playerVolumes.get(id) ?? 1
    entry.track.setVolume(Math.max(0, Math.min(personal * this.masterVolume, 1)))
  }

  /** 保存済みデバイスで生マイクを取得する。初回はここで許可プロンプトが出る */
  private createRawMic(deviceId: string): Promise<LocalAudioTrack> {
    return createLocalAudioTrack({
      deviceId: deviceId || undefined,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    })
  }

  /**
   * マイクの送信経路を組んで公開する。
   * 生マイク → micSource → gateGain(ノイズゲート) → micDest → publishTrack。
   * analyserはmicSourceから分岐(ゲート前のレベルをメーター・口パクに使う)。
   */
  private async setupMic(): Promise<void> {
    const raw = await this.createRawMic(loadMicDeviceId())
    this.rawMic = raw
    this.gateGain = this.context.createGain()
    this.gateGain.gain.value = 0 // 声が入るまで閉じておく
    this.micDest = this.context.createMediaStreamDestination()
    this.gateGain.connect(this.micDest)
    this.analyser = this.context.createAnalyser()
    this.analyser.fftSize = 512
    this.analyserData = new Uint8Array(this.analyser.fftSize)
    this.micSource = this.context.createMediaStreamSource(new MediaStream([raw.mediaStreamTrack]))
    this.micSource.connect(this.gateGain)
    this.micSource.connect(this.analyser)
    try {
      this.micPublication = await this.room.localParticipant.publishTrack(
        this.micDest.stream.getAudioTracks()[0],
        { source: Track.Source.Microphone, name: 'mic' },
      )
    } catch (err) {
      await this.teardownMic(false)
      throw err
    }
    // 開発時のみ: ヘッドレス検証から送信経路の内部状態を覗くためのフック
    if (import.meta.env.DEV) {
      ;(window as unknown as { __voiceDebug?: VoiceChat }).__voiceDebug = this
    }
  }

  /** 送信経路の解体。unpublish=falseはdispose用(roomごと切断される時) */
  private async teardownMic(unpublish: boolean): Promise<void> {
    const pub = this.micPublication
    this.micPublication = null
    this.micSource?.disconnect()
    this.micSource = null
    this.gateGain?.disconnect()
    this.gateGain = null
    this.micDest = null
    this.analyser = null
    this.analyserData = null
    this.rawMic?.stop()
    this.rawMic = null
    this.level = 0
    if (unpublish && pub?.track) {
      await this.room.localParticipant.unpublishTrack(pub.track, true)
    }
  }

  private updateListener(pos: { x: number; z: number }): void {
    const listener = this.context.listener
    if (!this.listenerInitialized) {
      this.listenerInitialized = true
      // カメラは回転しない固定アングル(画面上=-Z、画面右=+X)なので向きは一度だけ
      if (listener.forwardX) {
        listener.forwardX.value = 0
        listener.forwardY.value = 0
        listener.forwardZ.value = -1
        listener.upX.value = 0
        listener.upY.value = 1
        listener.upZ.value = 0
      } else {
        listener.setOrientation(0, 0, -1, 0, 1, 0)
      }
    }
    if (listener.positionX) {
      const t = this.context.currentTime
      listener.positionX.setTargetAtTime(pos.x, t, POSITION_SMOOTHING)
      listener.positionY.setTargetAtTime(VOICE_HEIGHT, t, POSITION_SMOOTHING)
      listener.positionZ.setTargetAtTime(pos.z, t, POSITION_SMOOTHING)
    } else {
      listener.setPosition(pos.x, VOICE_HEIGHT, pos.z)
    }
  }

  private setPannerPosition(panner: PannerNode, x: number, y: number, z: number): void {
    if (panner.positionX) {
      const t = this.context.currentTime
      panner.positionX.setTargetAtTime(x, t, POSITION_SMOOTHING)
      panner.positionY.setTargetAtTime(y, t, POSITION_SMOOTHING)
      panner.positionZ.setTargetAtTime(z, t, POSITION_SMOOTHING)
    } else {
      panner.setPosition(x, y, z)
    }
  }
}
