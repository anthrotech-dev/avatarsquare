import { type RemoteParticipant, type RemoteTrack, Room, RoomEvent, Track } from 'livekit-client'
import { getTokenEndpoint } from './config'
import { decodeMessage, encodeMessage, type GameMessage, isSystemId } from './protocol'
import { getVoiceAudioContext, VoiceChat, type VoiceChatCallbacks } from './VoiceChat'

export interface NetEvents {
  onRemoteVideo(id: string, video: HTMLVideoElement): void
  onRemoteMessage(id: string, message: GameMessage): void
  /** 自分より後に参加した人が入室した(既存参加者では発火しない) */
  onPeerJoined(id: string): void
  onRemoteLeft(id: string): void
  onPeersChanged(count: number): void
}

/**
 * LiveKitとの接続を担当する。
 * 自アバターの描画結果を映像トラックとして送信し、位置などのゲームメッセージを
 * DataChannelで送受信する。音声(ボイスチャット)はVoiceChatに委譲する。
 */
export class NetClient {
  private room: Room | null = null
  private _voice: VoiceChat | null = null

  get connected(): boolean {
    return this.room !== null
  }

  /** ボイスチャット。接続中のみ非null */
  get voice(): VoiceChat | null {
    return this._voice
  }

  async connect(
    roomName: string,
    identity: string,
    track: MediaStreamTrack,
    events: NetEvents,
    voiceCallbacks: VoiceChatCallbacks,
  ) {
    const res = await fetch(
      `${getTokenEndpoint()}?room=${encodeURIComponent(roomName)}&name=${encodeURIComponent(identity)}`,
    )
    if (!res.ok) throw new Error(`トークン取得に失敗しました (${res.status})`)
    const { token, url } = (await res.json()) as { token: string; url: string }

    const room = new Room({
      // 空間定位(PannerNode挿入)のため全音声をWebAudio経由で鳴らす
      // (マイクデバイスの選択はVoiceChat.setupMicが保存値を読む)
      webAudioMix: { audioContext: getVoiceAudioContext() },
    })
    // Roomイベントを取りこぼさないよう、connect前に生成してリスナーを張る
    const voice = new VoiceChat(room, voiceCallbacks)

    // システム参加者(ワールドボット等)は人数に数えない
    const notifyPeers = () =>
      events.onPeersChanged(
        [...room.remoteParticipants.values()].filter((p) => !isSystemId(p.identity)).length,
      )

    room
      .on(RoomEvent.TrackSubscribed, (remote: RemoteTrack, _pub, participant) => {
        if (remote.kind !== Track.Kind.Video) return
        const video = remote.attach() as HTMLVideoElement
        video.muted = true
        void video.play().catch(() => {})
        events.onRemoteVideo(participant.identity, video)
      })
      .on(RoomEvent.DataReceived, (payload: Uint8Array, participant?: RemoteParticipant) => {
        if (!participant) return
        const message = decodeMessage(payload)
        if (message) events.onRemoteMessage(participant.identity, message)
      })
      .on(RoomEvent.ParticipantConnected, (participant) => {
        events.onPeerJoined(participant.identity)
        notifyPeers()
      })
      .on(RoomEvent.ParticipantDisconnected, (participant) => {
        events.onRemoteLeft(participant.identity)
        notifyPeers()
      })

    try {
      await room.connect(url, token)
      await room.localParticipant.publishTrack(track, {
        name: 'avatar',
        simulcast: false,
      })
    } catch (err) {
      voice.dispose()
      room.disconnect()
      throw err
    }
    this.room = room
    this._voice = voice
    notifyPeers()
  }

  /** 位置更新など、多少落ちてもよいメッセージ */
  sendLossy(message: GameMessage): void {
    this.room?.localParticipant.publishData(encodeMessage(message), { reliable: false })
  }

  /** アクションなど、確実に届けたいメッセージ。toで宛先を絞れる(省略時は全員) */
  sendReliable(message: GameMessage, to?: string[]): void {
    this.room?.localParticipant.publishData(encodeMessage(message), {
      reliable: true,
      destinationIdentities: to,
    })
  }

  disconnect(): void {
    this._voice?.dispose()
    this._voice = null
    this.room?.disconnect()
    this.room = null
  }
}
