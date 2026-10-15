import * as THREE from 'three'
import { Avatar } from '../avatar/Avatar'
import { AvatarStreamer } from '../avatar/AvatarStreamer'
import type { AnimationFileKind } from '../avatar/animationLoaders'
import { AVATAR_LAYER } from '../avatar/captureSpec'
import { clearCachedVRM, loadCachedVRM, saveCachedVRM } from '../avatar/vrmCache'
import { registerBuiltins } from '../command/builtins'
import { CommandRegistry } from '../command/CommandRegistry'
import { MacroStore, wireMacros } from '../command/macros'
import type { GameCommandAPI, SkillTarget } from '../command/types'
import { NetClient } from '../net/NetClient'
import {
  clampWhisperRadius,
  isSceneAuthorityMessage,
  isSystemId,
  isVoiceMode,
  type SceneDespawnMessage,
  type SceneEventMessage,
  type ScenePatchMessage,
  type SceneSnapshotMessage,
  type SceneSpawnMessage,
  type StatMessage,
  sanitizeChatText,
  sanitizeName,
  type VoiceMode,
  type VoiceModeMessage,
  WHISPER_RADIUS_DEFAULT,
  WORLD_BOT_ID,
} from '../net/protocol'
import type { PeerVoiceState } from '../net/VoiceChat'
import { matchKeybind, mouseCode } from '../state/keybinds'
import { type TargetKind, useAppStore } from '../state/store'
import { saveMicDeviceId } from '../state/voice'
import { emoteUrl } from '../ui/hud/emotes'
import { SceneRenderer } from '../world/SceneRenderer'
import { buildNavGrid, parseWorld, type WorldDef } from '../world/WorldDef'
import { fetchWorld, fetchWorlds } from '../world/worldApi'
import { type ActionDef, BUILTIN_ACTIONS } from './actions'
import { type BuffInfo, normalizeBuffs, type SelfBuffDef } from './buffs'
import { EffectSystem } from './EffectSystem'
import { registerBuiltinEffects } from './effects'
import { acquireFlatMaterial, releaseFlatMaterial } from './materialPool'
import type { NavGrid } from './pathfinding'
import { RemoteAvatars } from './RemoteAvatars'
import { TargetRing } from './TargetRing'
import { WhisperRings } from './WhisperRings'

// 平行投影の固定アングル(LoL風の2Dルック)。仰角 約42°
const CAMERA_DIR = new THREE.Vector3(0, 0.9, 1).normalize()
const CAMERA_DISTANCE = 60
const ZOOM_MIN = 0.7 // 画面半分の高さ(ワールド単位)。小さいほど寄る(顔が見えるくらい)
const ZOOM_MAX = 32 // マップ全体が見渡せる
const ZOOM_DEFAULT = 9
const MARKER_LIFETIME = 0.6 // 秒
/** 移動マーカーの共有ジオメトリ(毎回同一形状。disposeしない) */
const MARKER_GEOMETRY = new THREE.RingGeometry(0.25, 0.35, 32)
/** ワールド一覧が取得できない場合の入室先(従来の既定ルーム) */
const FALLBACK_ROOM = 'square'
/** 自サイトのpublicに同梱しているワールド(サーバー未設定でも動くフォールバック) */
const LOCAL_WORLD_URL = '/worlds/square.json'
const POS_SEND_INTERVAL = 1 / 15 // 秒
const HUD_POS_INTERVAL = 0.2 // 秒。HUDの座標表示更新(毎フレームはReact再レンダ嵐になる)
const EDGE_MARGIN = 32 // px。この幅にカーソルが入るとその方向へスクロール
const EDGE_PAN_SPEED = 2.0 // ズーム(半画面高さ)1あたりの移動速度(unit/s)
const PAN_LIMIT = 28 // 視点移動できる範囲(マップ端まで)
/** 自分のウィスパー円のキー(identityは接続ごとに変わるため固定キーを使う) */
const SELF_RING_ID = '__self'
/** クリックインタラクトが届く距離(m)。サーバー側の検証(3m)より少し狭い */
const INTERACT_RANGE = 2.5
/** 自動接近中、対象がこの距離(m)を超えて動いたら経路を引き直す */
const APPROACH_REPATH_DIST = 0.5
/** 自分の最大HP。HPはクライアント権威(自分のHPは自分が管理する)。store初期値と対応 */
const PLAYER_MAX_HP = 100
/** ダッシュ(/dash)の効果時間と移動速度倍率。自分バフはクライアント権威 */
const DASH_DURATION_MS = 10_000
const DASH_SPEED_MULTIPLIER = 1.5
/**
 * 他プレイヤーからの回復(act heal, tid=自分)で回復する量。HPはクライアント権威なので
 * 送信側の数値は信用せず受信側の定数で適用する(builtins.tsのHEAL_AMOUNTと対応)
 */
const HEAL_RECEIVE_AMOUNT = 30
/** プレイヤーを対象にしたときの的の半径(m)。射程判定と選択リングに使う */
const PLAYER_TARGET_RADIUS = 0.5

/** 選択中ターゲットの参照。node=シーンノードid、player=参加者identity、self=自分(idは自分のidentity) */
interface TargetRef {
  kind: TargetKind
  id: string
}

/** レイキャストの結果。nodeのidはヒットしたノード自身(targetable等の祖先解決は呼び出し側) */
type PickResult = TargetRef

/** 他プレイヤーが配ってきたステータス(stat)。本人がクライアント権威 */
interface PeerStat {
  hp: number
  hpMax: number
  buffs: BuffInfo[]
}

interface ClickMarker {
  mesh: THREE.Mesh
  age: number
}

export class Game {
  private readonly container: HTMLElement
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera: THREE.OrthographicCamera
  private readonly clock = new THREE.Clock()
  private readonly raycaster = new THREE.Raycaster()
  private readonly avatar: Avatar
  /** 現在のワールドの描画・ナビゲーション。ワールド読込完了まではnull */
  private sceneRenderer: SceneRenderer | null = null
  private navGrid: NavGrid | null = null
  private world: WorldDef | null = null
  /** 選択中ターゲット(正はここ。HUDへはstoreへスナップショットを流す) */
  private selectedTarget: TargetRef | null = null
  /** 他プレイヤーのステータス(statメッセージ)。keyは参加者identity */
  private readonly peerStats = new Map<string, PeerStat>()
  private readonly targetRing = new TargetRing(this.scene)
  /** ?room=での入室先の明示指定。/worldでの切替後は新ワールドを優先するため破棄する */
  private roomOverride = new URLSearchParams(location.search).get('room')
  private readonly markers: ClickMarker[] = []
  private readonly resizeObserver: ResizeObserver
  private zoom = ZOOM_DEFAULT
  private zoomTarget = ZOOM_DEFAULT
  private readonly focus = new THREE.Vector3()
  private followAvatar = true
  private pointer: { x: number; y: number } | null = null
  /** 右ボタンのホットバーバインドが発火した直後、既定の右クリック移動を1回だけ抑止する */
  private suppressNextContextMenu = false
  private readonly streamer = new AvatarStreamer()
  private readonly remotes: RemoteAvatars
  private readonly effects: EffectSystem
  private readonly actions = new Map<string, ActionDef>()
  private readonly registry = new CommandRegistry()
  readonly macroStore = new MacroStore()
  private net = new NetClient()
  private posAccum = 0
  private hudPosAccum = 0
  private disposed = false
  // VRM読み込みの直列化。キャッシュ復元と手動ドロップの競合を防ぐ
  private vrmChain: Promise<unknown> = Promise.resolve()
  private userVRMRequested = false
  private readonly unsubscribeStore: () => void
  private lastSentName = ''
  /** 自分のidentity。名前未設定時のチャットログ表示にフォールバックとして使う */
  private identity = ''
  /** 自分のHP(クライアント権威)。storeへはHUD表示用のスナップショットを流す */
  private selfHp = PLAYER_MAX_HP
  /** 戦闘不能中。移動・アクション等を止め、復活(respawn)で解除する */
  private dead = false
  /** 自分に掛かっているバフ・デバフ(クライアント権威)。keyはバフid。storeへはスナップショットを流す */
  private readonly selfBuffs = new Map<
    string,
    { info: BuffInfo; effects?: SelfBuffDef['effects'] }
  >()
  /**
   * エンティティのバフ・デバフ(サーバー権威のノード属性buffs)のキャッシュ。keyはノードid。
   * ワイヤのremainingMsは送信時点の残り時間なので、受信時にexpiresAtへ変換して保持する
   * (pushTargetToStoreは選択変更時にも呼ばれ、その時点のノード属性値は陳腐化しているため)
   */
  private readonly targetBuffsCache = new Map<string, BuffInfo[]>()
  /** 射程外の対象への自動接近。射程に入るとcommandを再実行する(毎フレームupdateApproachで判定) */
  private pendingApproach: {
    kind: 'skill' | 'interact'
    target: TargetRef
    /** 発動判定: dist - radius <= range(interactはradius=0で中心間距離) */
    range: number
    radius: number
    /** 到着時に再実行するコマンド行(例: '/attack', '/interact door1') */
    command: string
    /** 経路探索したときの対象位置。動く対象の追跡(再探索)判定に使う */
    goal: { x: number; z: number }
  } | null = null
  /** 現在発話中のリモート参加者(SFU判定)。差分でネームプレート表示を切り替える */
  private speakingIds = new Set<string>()
  /** 自分の発話中(ローカルのマイク音量による即時判定) */
  private selfSpeaking = false
  /** 自分の発音モード。VC OFF中も保持し、次の参加時から効く */
  private voiceMode: VoiceMode = 'normal'
  private whisperRadius = WHISPER_RADIUS_DEFAULT
  /** リモート話者の発音モード(vmodeメッセージから。normalは持たない) */
  private readonly peerVoiceModes = new Map<string, { mode: VoiceMode; radius: number }>()
  /** リモートのVC状態(円の表示判定用。offは持たない) */
  private readonly peerVoiceStates = new Map<string, PeerVoiceState>()
  private readonly whisperRings: WhisperRings

  constructor(container: HTMLElement) {
    this.container = container

    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    // コンパイル直後のgetShaderInfoLog等の同期GPUストール(長タスクの原因)を避ける
    this.renderer.debug.checkShaderErrors = false
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    container.appendChild(this.renderer.domElement)

    this.scene.background = new THREE.Color(0x25381f)
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200)

    // マップはワールドJSONの読込後にapplyWorld()で構築する(start()から)

    this.setupLights()
    this.avatar = new Avatar(this.scene)
    this.remotes = new RemoteAvatars(this.scene)
    this.effects = new EffectSystem(this.scene)
    this.whisperRings = new WhisperRings(this.scene)
    registerBuiltinEffects(this.effects)
    for (const action of BUILTIN_ACTIONS) this.actions.set(action.name, action)

    registerBuiltins(this.registry, this.macroStore)
    wireMacros(this.registry, this.macroStore)
    this.macroStore.onChange = () => useAppStore.getState().bumpMacros()
    useAppStore.getState().setDispatch(this.dispatch)

    // 表示名(プレイヤー名 > VRM名)の変化でネームプレート更新+profile送信。
    // VC音量の変更(UIのスライダー)もここでVoiceChatへ流す
    this.unsubscribeStore = useAppStore.subscribe((state, prev) => {
      if (state.playerName !== prev.playerName || state.avatarName !== prev.avatarName) {
        this.refreshNameplate()
      }
      if (state.voiceMasterVolume !== prev.voiceMasterVolume) {
        this.net.voice?.setMasterVolume(state.voiceMasterVolume)
      }
      if (state.noiseGate !== prev.noiseGate) {
        this.net.voice?.setNoiseGate(state.noiseGate)
      }
      if (state.playerVolumes !== prev.playerVolumes) {
        for (const [id, volume] of Object.entries(state.playerVolumes)) {
          if (prev.playerVolumes[id] !== volume) this.net.voice?.setPlayerVolume(id, volume)
        }
      }
    })
    this.refreshNameplate()

    this.focus.copy(this.avatar.position)
    this.updateCamera()

    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(container)
    this.resize()

    this.renderer.domElement.addEventListener('contextmenu', this.onContextMenu)
    this.renderer.domElement.addEventListener('click', this.onClick)
    this.renderer.domElement.addEventListener('wheel', this.onWheel, { passive: false })
    this.renderer.domElement.addEventListener('mousemove', this.onMouseMove)
    this.renderer.domElement.addEventListener('mouseleave', this.onMouseLeave)
    this.renderer.domElement.addEventListener('mousedown', this.onMouseDown)
    window.addEventListener('mousedown', this.suppressNavButtons, { capture: true })
    window.addEventListener('mouseup', this.suppressNavButtons, { capture: true })
    window.addEventListener('auxclick', this.suppressNavButtons, { capture: true })
    window.addEventListener('keydown', this.onKeyDown)
    // リロード・タブ閉じ時に明示的に切断する(接続処理との競合による内部エラー防止)
    window.addEventListener('pagehide', this.onPageHide)
  }

  private readonly onPageHide = (): void => {
    this.net.disconnect()
  }

  start(): void {
    this.renderer.setAnimationLoop(this.tick)
    void this.loadInitialWorld()
    void this.restoreCachedVRM()
  }

  /** 起動時のワールド読込。完了してからネット接続する(入室先=ワールドid) */
  private async loadInitialWorld(): Promise<void> {
    const { setWorldLoading } = useAppStore.getState()
    setWorldLoading('ワールドを読み込み中...')
    try {
      const source = (await this.fetchServerWorld()) ?? (await this.fetchLocalWorld())
      if (this.disposed) return
      this.applyWorld(source.world, source.url)
      setWorldLoading(null)
    } catch (err) {
      // マップが無いと何もできないので、オーバーレイにエラーを出したまま止める
      setWorldLoading(
        `ワールドの読み込みに失敗しました: ${err instanceof Error ? err.message : String(err)}`,
      )
      return
    }
    void this.connectNet()
  }

  /**
   * サーバー(/worlds)からワールドを取得する。?world=で指定があればそれを、
   * なければ一覧の先頭を使う。サーバー未対応・オフラインならnull(ローカルへフォールバック)
   */
  private async fetchServerWorld(): Promise<{ world: WorldDef; url: string } | null> {
    try {
      const worlds = await fetchWorlds()
      if (worlds.length === 0) return null
      useAppStore.getState().setWorlds(worlds)
      const requested = new URLSearchParams(location.search).get('world')
      const id = worlds.some((w) => w.id === requested) && requested ? requested : worlds[0].id
      return await fetchWorld(id)
    } catch {
      return null
    }
  }

  /** 自サイトのpublicに同梱しているワールド(サーバー未設定でも動くフォールバック) */
  private async fetchLocalWorld(): Promise<{ world: WorldDef; url: string }> {
    const res = await fetch(LOCAL_WORLD_URL)
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
    return { world: parseWorld(await res.json()), url: LOCAL_WORLD_URL }
  }

  /**
   * 別ワールドへ移動する。取得に失敗した場合は現在のワールドに留まる。
   * 成功したらロード画面を挟んで切断→シーン差し替え→再接続する
   */
  async switchWorld(id: string): Promise<void> {
    const { setWorldLoading } = useAppStore.getState()
    const source = await fetchWorld(id) // 失敗はthrow(コマンド側で表示)
    if (this.disposed) return
    setWorldLoading(`「${source.world.name}」へ移動中...`)
    this.roomOverride = null
    try {
      await this.rejoinSession(() => this.applyWorld(source.world, source.url))
    } finally {
      if (!this.disposed) setWorldLoading(null)
    }
  }

  /**
   * ワールドをシーンへ反映する(初回とワールド切替の共通経路)。
   * 旧ワールドのGPUリソースはここで解放する。
   */
  private applyWorld(world: WorldDef, worldUrl: string): void {
    // 選択ターゲットは旧ワールドのノード・参加者を指しているため解除する
    this.selectedTarget = null
    this.targetRing.clear()
    useAppStore.getState().setTarget(null)
    // バフは旧ワールドのものなので全て剥がす。初期シーンの静的buffs属性を拾い直す
    this.clearSelfBuffs()
    this.targetBuffsCache.clear()
    const buffStamp = performance.now()
    for (const node of world.scene) this.stampBuffsFromTree(node, buffStamp)
    this.sceneRenderer?.dispose()
    this.world = world
    this.sceneRenderer = new SceneRenderer(world, worldUrl)
    this.scene.add(this.sceneRenderer.group)
    // 初期シーンで事前計算(以後の動的spawn/despawnはmarkNavGridDirtyで再構築)
    this.navGrid = buildNavGrid(world)
    this.stopMovement()
    this.avatar.position.set(world.spawn.x, 0, world.spawn.z)
    this.focus.copy(this.avatar.position)
    // 戦闘不能のままワールドを切り替えた場合は全快で入り直す
    this.dead = false
    this.selfHp = PLAYER_MAX_HP
    this.avatar.setDead(false)
    useAppStore.getState().setSelfHp(this.selfHp, PLAYER_MAX_HP)
    useAppStore.getState().setDead(false)
    useAppStore.getState().setWorld({ id: world.id, name: world.name })
  }

  /** 表示名。プレイヤー名が未設定ならVRMモデル名を代用する */
  private displayName(): string {
    const { playerName, avatarName } = useAppStore.getState()
    return playerName || avatarName || ''
  }

  /** 自分のネームプレートを更新し、表示名が変わっていればprofileを送る */
  private refreshNameplate(): void {
    const name = this.displayName()
    this.avatar.setNameplate(name)
    if (name !== this.lastSentName) {
      this.lastSentName = name
      this.net.sendReliable({ t: 'profile', name })
    }
  }

  /** エンドポイント変更時などに接続を張り直す。VCに参加中なら再参加する */
  async reconnect(): Promise<void> {
    await this.rejoinSession()
  }

  /** リモート由来のセッション状態を全て消す(再接続・ワールド切替の共通処理) */
  private clearSessionState(): void {
    this.remotes.clear()
    this.peerStats.clear()
    // 他プレイヤーの選択は再接続で無効になる(自分・ノードの選択は維持)
    if (this.selectedTarget?.kind === 'player') this.pushTargetToStore()
    this.speakingIds.clear()
    this.peerVoiceModes.clear()
    this.peerVoiceStates.clear()
    this.whisperRings.clear()
    useAppStore.getState().setPeers(0)
    useAppStore.getState().clearPlayers()
    useAppStore.getState().clearVoicePeers()
    this.syncSelfVoiceUI()
  }

  /**
   * 切断→状態クリア→(必要ならシーン差し替え)→再接続。
   * 発音モードとVC参加はセッション状態として引き継ぐ
   */
  private async rejoinSession(beforeConnect?: () => void): Promise<void> {
    const wasVoiceOn = this.net.voice?.enabled ?? false
    this.net.disconnect()
    this.clearSessionState()
    beforeConnect?.()
    await this.connectNet()
    // 発音モードはセッション状態として引き継ぐ(vmodeは接続後に改めて配る)
    if (this.voiceMode !== 'normal') this.net.sendReliable(this.voiceModeMessage())
    // マイク許可は取得済みなのでプロンプトなしで再参加できる
    if (wasVoiceOn && this.net.voice) {
      try {
        await this.net.voice.setEnabled(true)
      } catch (err) {
        useAppStore.getState().appendChat({
          kind: 'error',
          text: `VCの再参加に失敗しました: ${err instanceof Error ? err.message : String(err)}`,
        })
      }
      this.syncSelfVoiceUI()
    }
  }

  /** ワールドボットからのシーン権威更新を描画へ反映する */
  private applySceneMessage(
    message:
      | ScenePatchMessage
      | SceneSnapshotMessage
      | SceneSpawnMessage
      | SceneDespawnMessage
      | SceneEventMessage,
  ): void {
    const renderer = this.sceneRenderer
    if (!renderer) return
    switch (message.t) {
      case 'gpatch':
        if ('buffs' in message.attrs) {
          this.targetBuffsCache.set(
            message.id,
            normalizeBuffs(message.attrs.buffs, performance.now()),
          )
        }
        renderer.applyPatch(message.id, message.attrs)
        if (this.isSelectedNode(message.id)) this.pushTargetToStore()
        break
      case 'gsnap': {
        const receivedAt = performance.now()
        for (const [id, attrs] of Object.entries(message.patches)) {
          if ('buffs' in attrs) {
            this.targetBuffsCache.set(id, normalizeBuffs(attrs.buffs, receivedAt))
          }
        }
        for (const spawn of message.spawns ?? []) this.stampBuffsFromTree(spawn.node, receivedAt)
        for (const id of message.despawns ?? []) this.targetBuffsCache.delete(id)
        renderer.applySnapshot(message.patches, message.spawns, message.despawns)
        if (message.spawns?.length || message.despawns?.length) this.markNavGridDirty()
        if (this.selectedTarget?.kind === 'node') this.pushTargetToStore()
        break
      }
      case 'gspawn':
        this.stampBuffsFromTree(message.node, performance.now())
        renderer.applySpawn(message.parent, message.node)
        this.markNavGridDirty()
        break
      case 'gdespawn':
        this.targetBuffsCache.delete(message.id)
        renderer.applyDespawn(message.id)
        this.markNavGridDirty()
        // 選択中のエンティティ(またはその祖先)が消えたら選択も自動解除される
        if (this.selectedTarget?.kind === 'node') this.pushTargetToStore()
        break
      case 'gevent': {
        // 対象が自分のhitは実ダメージ(geventは__world発の検証済み経路でしか届かない)
        if (message.name === 'hit' && message.data?.target === this.identity) {
          const damage = Number(message.data.damage)
          if (Number.isFinite(damage) && damage > 0) this.applyDamage(damage)
        }
        // 演出イベントは名前をエフェクトkindに対応させる(未知kindはEffectSystemが
        // 無視するので前方互換)。座標はdataのx/zがあればそれ、無ければノード位置
        const kind = message.name === 'hit' ? 'hitflash' : message.name
        const dx = message.data?.x
        const dz = message.data?.z
        const pos =
          typeof dx === 'number' &&
          Number.isFinite(dx) &&
          typeof dz === 'number' &&
          Number.isFinite(dz)
            ? { x: dx, z: dz }
            : renderer.worldPosition(message.id)
        if (pos) this.effects.spawn({ kind, x: pos.x, z: pos.z })
        break
      }
    }
  }

  /**
   * 他プレイヤーのstatを受け取る。値は相手のクライアント改造に備えて検証し、
   * buffsはノード属性buffsと同じ正規化(remainingMs→expiresAt)を通す
   */
  private applyPeerStat(id: string, message: StatMessage): void {
    const hp = Number(message.hp)
    const hpMax = Number(message.hpMax)
    if (!Number.isFinite(hp) || !Number.isFinite(hpMax) || hpMax <= 0) return
    this.peerStats.set(id, {
      hp: Math.max(0, Math.min(hpMax, hp)),
      hpMax,
      buffs: normalizeBuffs(message.buffs, performance.now()),
    })
    if (this.isSelectedPlayer(id)) this.pushTargetToStore()
  }

  /**
   * 自分への被弾。戦闘不能中の追撃(サーバーの除外が効くまでのラグや
   * 複数体の同時攻撃)は無視する
   */
  private applyDamage(damage: number): void {
    if (this.dead) return
    this.selfHp = Math.max(0, this.selfHp - damage)
    this.syncSelfStatus()
    if (this.selfHp === 0) this.die()
  }

  /**
   * 自分のHPを回復する(自分のHPはクライアント権威)。
   * /healの自己対象と、他プレイヤーからのact(heal, tid=自分)の両方がここに来る
   */
  private applyHeal(amount: number): void {
    if (this.dead || !Number.isFinite(amount) || amount <= 0) return
    this.selfHp = Math.min(PLAYER_MAX_HP, this.selfHp + amount)
    this.syncSelfStatus()
  }

  /**
   * 回復スキルの発動(送信側)。自分なら即時適用、他プレイヤーなら対象本人へ
   * actで通知し本人が適用する(エフェクトはperformAction側で全員に出る)
   */
  heal(target: SkillTarget, amount: number): void {
    if (this.dead) throw new Error('戦闘不能中は使えません')
    if (target.kind === 'node') throw new Error('この対象には使えません')
    if (!target.alive) throw new Error(`「${target.name}」は戦闘不能です`)
    if (target.kind === 'self') this.applyHeal(amount)
    // playerはperformActionのact(tid=identity)を受けた本人が適用する
  }

  /**
   * 自分のHP・バフの変化を各所へ反映する: HUD(store)、自分を選択中ならターゲットHUD、
   * 他プレイヤー(statメッセージ。向こうで自分がターゲットされたときの表示用)
   */
  private syncSelfStatus(): void {
    const store = useAppStore.getState()
    store.setSelfHp(this.selfHp, PLAYER_MAX_HP)
    store.setSelfBuffs([...this.selfBuffs.values()].map((b) => b.info))
    if (this.selectedTarget?.kind === 'self') this.pushTargetToStore()
    this.sendStat()
  }

  /** 自分のステータスを配る(to省略で全員)。buffsはノード属性buffsと同じワイヤ形式 */
  private sendStat(to?: string[]): void {
    if (!this.net.connected) return
    const now = performance.now()
    this.net.sendReliable(
      {
        t: 'stat',
        hp: this.selfHp,
        hpMax: PLAYER_MAX_HP,
        buffs: [...this.selfBuffs.values()].map(({ info }) => ({
          id: info.id,
          name: info.name,
          kind: info.kind,
          remainingMs: info.expiresAt !== null ? Math.max(0, info.expiresAt - now) : undefined,
          durationMs: info.durationMs ?? undefined,
        })),
      },
      to,
    )
  }

  /** HP0で戦闘不能になる。移動を止めて倒れ、復活ダイアログを出す */
  private die(): void {
    this.dead = true
    this.pendingApproach = null
    this.clearSelfBuffs()
    this.avatar.setDead(true)
    const store = useAppStore.getState()
    store.setDead(true)
    store.appendChat({ kind: 'system', text: '倒れました。/respawn で復活できます' })
    // 次のpos送信からdead=trueが伝わり、サーバーがスクリプトの索敵から除外する
  }

  /** スポーン地点で復活する(戦闘不能時のみ)。HP全快で死亡状態を解除する */
  respawn(): void {
    if (!this.dead) throw new Error('戦闘不能ではありません')
    this.dead = false
    this.selfHp = PLAYER_MAX_HP
    this.avatar.setDead(false)
    this.stopMovement()
    if (this.world) this.avatar.position.set(this.world.spawn.x, 0, this.world.spawn.z)
    // カメラ追従OFFでも復帰位置を見失わないようにスナップする
    this.focus.copy(this.avatar.position)
    this.syncSelfStatus()
    useAppStore.getState().setDead(false)
  }

  /** 10秒間移動速度を上げるバフを自分に付与する(/dash)。戦闘不能中はthrow(CD返金) */
  dash(): void {
    if (this.dead) throw new Error('戦闘不能中は使えません')
    this.addSelfBuff({
      id: 'dash',
      name: 'ダッシュ',
      kind: 'buff',
      durationMs: DASH_DURATION_MS,
      effects: { speedMultiplier: DASH_SPEED_MULTIPLIER },
    })
  }

  /** 自分にバフを付与する。同idは上書き=残時間リフレッシュ */
  private addSelfBuff(def: SelfBuffDef): void {
    const info: BuffInfo = {
      id: def.id,
      name: def.name,
      kind: def.kind,
      expiresAt: performance.now() + def.durationMs,
      durationMs: def.durationMs,
    }
    this.selfBuffs.set(def.id, { info, effects: def.effects })
    this.recomputeBuffEffects()
    this.syncSelfStatus()
  }

  /** 期限切れの自分バフを剥がす。tick()から毎フレーム呼ばれる */
  private updateSelfBuffs(): void {
    if (this.selfBuffs.size === 0) return
    const now = performance.now()
    let removed = false
    for (const [id, buff] of this.selfBuffs) {
      if (buff.info.expiresAt !== null && now >= buff.info.expiresAt) {
        this.selfBuffs.delete(id)
        removed = true
      }
    }
    if (removed) {
      this.recomputeBuffEffects()
      this.syncSelfStatus()
    }
  }

  /** 自分バフを全て剥がす(死亡・ワールド切替)。効果も元に戻る */
  private clearSelfBuffs(): void {
    if (this.selfBuffs.size === 0) return
    this.selfBuffs.clear()
    this.recomputeBuffEffects()
    this.syncSelfStatus()
  }

  /** 全バフの効果を集計してアバターへ反映する(冪等) */
  private recomputeBuffEffects(): void {
    let speed = 1
    for (const buff of this.selfBuffs.values()) {
      speed *= buff.effects?.speedMultiplier ?? 1
    }
    this.avatar.setSpeedMultiplier(speed)
  }

  /**
   * ノードツリーからbuffs属性を拾ってキャッシュに受信時刻でスタンプする
   * (gspawn/gsnapのspawns・ワールド初期シーン用)
   */
  private stampBuffsFromTree(node: Record<string, unknown>, receivedAt: number): void {
    if (typeof node.id === 'string' && node.buffs !== undefined) {
      this.targetBuffsCache.set(node.id, normalizeBuffs(node.buffs, receivedAt))
    }
    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        if (typeof child === 'object' && child !== null) {
          this.stampBuffsFromTree(child as Record<string, unknown>, receivedAt)
        }
      }
    }
  }

  /**
   * 動的spawn/despawnで通行判定(navGrid)が変わったときの再構築。
   * 連続するシーン変化を1回にまとめるためmicrotaskで遅延する
   */
  private navGridDirty = false
  private markNavGridDirty(): void {
    if (this.navGridDirty) return
    this.navGridDirty = true
    queueMicrotask(() => {
      this.navGridDirty = false
      if (this.disposed || !this.world || !this.sceneRenderer) return
      this.navGrid = buildNavGrid({ ...this.world, scene: this.sceneRenderer.liveScene() })
    })
  }

  /** 選択中ターゲットが指定ノードか(gpatch等でHUDを更新するかの判定) */
  private isSelectedNode(id: string): boolean {
    return this.selectedTarget?.kind === 'node' && this.selectedTarget.id === id
  }

  /** 選択中ターゲットが指定プレイヤーか(stat/profile/退室でHUDを更新するかの判定) */
  private isSelectedPlayer(id: string): boolean {
    return this.selectedTarget?.kind === 'player' && this.selectedTarget.id === id
  }

  /**
   * /targetの引数を対象参照へ解決する。優先順: 'self' > targetableなシーンノードid >
   * プレイヤーidentity > プレイヤー表示名(完全一致、複数いれば先頭)。該当なしはnull
   */
  private resolveTargetRef(id: string): TargetRef | null {
    if (id === 'self') return { kind: 'self', id: this.identity }
    const node = this.sceneRenderer?.getNode(id)
    if (node?.targetable === true) return { kind: 'node', id }
    if (this.remotes.has(id)) return { kind: 'player', id }
    const byName = useAppStore
      .getState()
      .players.find((p) => p.name === id && this.remotes.has(p.id))
    if (byName) return { kind: 'player', id: byName.id }
    return null
  }

  /**
   * 対象を選択する(null=解除)。idはtargetableなシーンノードid、プレイヤーのidentity
   * または表示名、'self'(自分)。該当なしはthrow(コマンド側で表示)
   */
  selectTarget(id: string | null): void {
    const ref = id === null ? null : this.resolveTargetRef(id)
    if (id !== null && !ref) throw new Error(`「${id}」は対象にできません`)
    this.setSelectedTarget(ref)
  }

  private setSelectedTarget(ref: TargetRef | null): void {
    // 対象変更・解除でスキルの自動接近を中止する(interactの接近は選択と無関係)
    const pending = this.pendingApproach
    if (
      pending?.kind === 'skill' &&
      (ref === null || ref.kind !== pending.target.kind || ref.id !== pending.target.id)
    ) {
      this.pendingApproach = null
    }
    this.selectedTarget = ref
    this.pushTargetToStore()
  }

  /**
   * 対象参照をスキル用の情報(名前・ワールド座標・半径・生存)へ展開する。
   * 消えたノード・退室したプレイヤーはnull。ノードの座標は補間ターゲット(サーバー値)、
   * プレイヤーは補間中の表示位置(位置はそれしか届かない)
   */
  private describeTarget(ref: TargetRef): SkillTarget | null {
    const renderer = this.sceneRenderer
    switch (ref.kind) {
      case 'node': {
        const node = renderer?.getNode(ref.id)
        if (node?.targetable !== true) return null
        const pos = renderer?.worldPosition(ref.id)
        if (!pos) return null
        const radius = typeof node.collider === 'number' && node.collider > 0 ? node.collider : 0.5
        return {
          kind: 'node',
          id: ref.id,
          name: String(node.name ?? ref.id),
          x: pos.x,
          z: pos.z,
          radius,
          alive: node.visible !== false,
        }
      }
      case 'player': {
        const pos = this.remotes.position(ref.id)
        if (!pos) return null
        return {
          kind: 'player',
          id: ref.id,
          name: this.peerDisplayName(ref.id),
          x: pos.x,
          z: pos.z,
          radius: PLAYER_TARGET_RADIUS,
          alive: !this.remotes.isDead(ref.id),
        }
      }
      case 'self':
        return this.acquireSelf()
    }
  }

  /** 自分をスキル対象として返す(/healの既定対象) */
  acquireSelf(): SkillTarget {
    return {
      kind: 'self',
      id: this.identity,
      name: this.displayName() || this.identity,
      x: this.avatar.position.x,
      z: this.avatar.position.z,
      radius: PLAYER_TARGET_RADIUS,
      alive: !this.dead,
    }
  }

  /** プレイヤーの表示名(profile)。未受信ならidentity */
  private peerDisplayName(id: string): string {
    return this.remotes.nameOf(id) || id
  }

  /**
   * 対象指定スキル用の対象取得。選択済みで有効ならそれを返し、
   * 未選択・無効ならカーソル直下の対象(targetableノード/プレイヤー/自分)を自動選択して返す
   */
  acquireTarget(): SkillTarget | null {
    if (this.selectedTarget) {
      const current = this.describeTarget(this.selectedTarget)
      // 倒れたノードは対象として無効(カーソル直下へフォールバック)。プレイヤーは生死を持ち帰る
      if (current && (current.kind !== 'node' || current.alive)) return current
    }
    // 未選択(または選択が無効): カーソル直下の対象を自動選択する
    if (!this.pointer) return null
    const rect = this.renderer.domElement.getBoundingClientRect()
    const picked = this.pickAt(this.pointer.x + rect.left, this.pointer.y + rect.top)
    const ref = picked ? this.pickToTargetRef(picked) : null
    if (!ref) return null
    const hovered = this.describeTarget(ref)
    if (!hovered || (hovered.kind === 'node' && !hovered.alive)) return null
    this.setSelectedTarget(ref)
    return hovered
  }

  /** レイキャスト結果を選択可能な対象参照へ解決する(targetable属性を持つ祖先ノード等) */
  private pickToTargetRef(picked: PickResult): TargetRef | null {
    if (picked.kind === 'node') {
      const id = this.sceneRenderer?.findAncestorWith(picked.id, 'targetable')
      return id ? { kind: 'node', id } : null
    }
    return picked
  }

  /**
   * 選択中ターゲットのHUDスナップショット(store)と選択リングを更新する。
   * 選択変更時と、対象に関わる更新(gpatch/gsnap/gdespawn、stat/profile/退室、自分のHP・バフ変化)
   * 時に呼ぶ。対象が消えていたら(despawn・退室)選択を自動解除する
   */
  private pushTargetToStore(): void {
    const { setTarget } = useAppStore.getState()
    const ref = this.selectedTarget
    const target = ref ? this.describeTarget(ref) : null
    if (!ref || !target) {
      this.selectedTarget = null
      this.targetRing.clear()
      setTarget(null)
      return
    }
    const alive = target.alive
    let hp: number | null = null
    let hpMax: number | null = null
    let buffs: BuffInfo[] = []
    switch (ref.kind) {
      case 'node': {
        const node = this.sceneRenderer?.getNode(ref.id)
        if (typeof node?.hp === 'number' && typeof node.hpMax === 'number') {
          hp = node.hp
          hpMax = node.hpMax
        }
        buffs = this.targetBuffsCache.get(ref.id) ?? []
        break
      }
      case 'player': {
        // 本人が配ったstat(未受信ならHPなし=名前だけ表示)
        const stat = this.peerStats.get(ref.id)
        if (stat) {
          hp = stat.hp
          hpMax = stat.hpMax
          buffs = stat.buffs
        }
        break
      }
      case 'self':
        hp = this.selfHp
        hpMax = PLAYER_MAX_HP
        buffs = [...this.selfBuffs.values()].map((b) => b.info)
        break
    }
    setTarget({ kind: ref.kind, id: ref.id, name: target.name, hp, hpMax, alive, buffs })
    if (alive) {
      this.targetRing.set({ x: target.x, z: target.z, radius: target.radius })
    } else {
      this.targetRing.clear()
    }
  }

  /**
   * 選択リングを対象の表示位置(補間中座標)へ毎フレーム追従させる。
   * 移動するエンティティ(スライム等)やプレイヤーを選択したままでも滑らかに付いていく
   */
  private updateTargetRing(): void {
    const ref = this.selectedTarget
    if (!ref) return
    let pos: { x: number; z: number } | null | undefined
    let radius = PLAYER_TARGET_RADIUS
    switch (ref.kind) {
      case 'node': {
        const renderer = this.sceneRenderer
        const node = renderer?.getNode(ref.id)
        // 非表示・消滅時のリングはpushTargetToStoreがclear済みなので触らない
        if (!node || node.visible === false) return
        pos = renderer?.viewWorldPosition(ref.id)
        radius = typeof node.collider === 'number' && node.collider > 0 ? node.collider : 0.5
        break
      }
      case 'player':
        if (this.remotes.isDead(ref.id)) return
        pos = this.remotes.position(ref.id)
        break
      case 'self':
        if (this.dead) return
        pos = this.avatar.position
        break
    }
    if (!pos) return
    this.targetRing.set({ x: pos.x, z: pos.z, radius })
  }

  /**
   * ノードへのインタラクト。判定はサーバー権威(結果はgpatchで返る)だが、
   * 無駄な送信を避けるため対象と距離をクライアントでも確認する
   */
  interactNode(id: string): void {
    if (this.dead) throw new Error('戦闘不能です。/respawn で復活してください')
    const node = this.sceneRenderer?.getNode(id)
    if (!node?.interactable) throw new Error(`「${id}」はインタラクトできません`)
    // 距離はワールド座標で判定する(ネストノード対応。接近判定updateApproachと同じ基準)
    const pos = this.sceneRenderer?.worldPosition(id)
    const x = pos?.x ?? 0
    const z = pos?.z ?? 0
    const distance = Math.hypot(x - this.avatar.position.x, z - this.avatar.position.z)
    if (distance > INTERACT_RANGE) {
      // 射程外: エラーにせず自動で接近し、射程に入ったら再実行する
      if (
        !this.startApproach('interact', { kind: 'node', id }, INTERACT_RANGE, 0, `/interact ${id}`)
      ) {
        throw new Error('そこへは到達できません')
      }
      return
    }
    // ポータル(portal属性=行き先ワールドid)はクライアント側でワールド切替する。
    // サーバーのwasmスクリプトは関与しない(切替失敗は/interactのcatchで表示される)
    if (typeof node.portal === 'string') {
      void this.switchWorld(node.portal)
      return
    }
    this.net.sendReliable({ t: 'ginput', id, action: 'interact' }, [WORLD_BOT_ID])
  }

  /**
   * リモートの発話中表示。spkメッセージ(送信側のローカル判定)で更新する。
   * SFUのActiveSpeakers検出は使わない: ゲート済み無音+DTXで長時間沈黙した
   * トラックが復帰後に検出されなくなる問題があり、往復遅延もあるため。
   */
  private applyRemoteSpeaking(id: string, speaking: boolean): void {
    if (speaking === this.speakingIds.has(id)) return
    if (speaking) this.speakingIds.add(id)
    else this.speakingIds.delete(id)
    this.remotes.setSpeaking(id, speaking)
    this.pushSpeakingToStore()
  }

  /**
   * 自分の発話中表示。毎フレーム呼ばれるが、変化時のみ反映し、
   * 他クライアントへも通知する(リモート側の表示はこれが正)。
   */
  private applySelfSpeaking(speaking: boolean): void {
    if (speaking === this.selfSpeaking) return
    this.selfSpeaking = speaking
    this.avatar.setSpeaking(speaking)
    this.net.sendReliable({ t: 'spk', on: speaking })
    this.pushSpeakingToStore()
  }

  private pushSpeakingToStore(): void {
    const ids = [...this.speakingIds]
    if (this.selfSpeaking && this.identity) ids.push(this.identity)
    useAppStore.getState().setSpeakingIds(ids.sort())
  }

  /** 自分のVC/ミュート状態をネームプレートとstoreへ反映する */
  private syncSelfVoiceUI(): void {
    const voice = this.net.voice
    const enabled = voice?.enabled ?? false
    const micMuted = voice?.micMuted ?? false
    const state: PeerVoiceState = !enabled ? 'off' : micMuted ? 'muted' : 'on'
    this.avatar.setVoiceState(state)
    useAppStore.getState().setVoiceState(enabled, micMuted)
    this.syncSelfRing()
  }

  /**
   * 自分の発音モードの変更。全員へvmodeを配り(減衰・遮断は受信側の責務)、
   * ネームプレート・円・storeへ反映する。VC OFF中でも設定できる
   */
  private applySelfVoiceMode(mode: VoiceMode, radius?: number): void {
    if (radius !== undefined) this.whisperRadius = clampWhisperRadius(radius)
    this.voiceMode = mode
    this.avatar.setVoiceMode(mode)
    useAppStore.getState().setVoiceMode(mode, this.whisperRadius)
    this.net.sendReliable(this.voiceModeMessage())
    this.syncSelfRing()
  }

  private voiceModeMessage(): VoiceModeMessage {
    return this.voiceMode === 'whisper'
      ? { t: 'vmode', mode: this.voiceMode, radius: this.whisperRadius }
      : { t: 'vmode', mode: this.voiceMode }
  }

  /** 自分のウィスパー円。VC参加中×whisperモードのときだけ出す(ミュート中も出す=意図の可視化) */
  private syncSelfRing(): void {
    const show = this.voiceMode === 'whisper' && (this.net.voice?.enabled ?? false)
    this.whisperRings.set(SELF_RING_ID, show ? this.whisperRadius : null)
  }

  /** リモート話者の発音モード(vmode受信)。相手のクライアント改造に備えて検証する */
  private applyPeerVoiceMode(id: string, message: VoiceModeMessage): void {
    const mode: VoiceMode = isVoiceMode(message.mode) ? message.mode : 'normal'
    const radius = clampWhisperRadius(message.radius)
    if (mode === 'normal') this.peerVoiceModes.delete(id)
    else this.peerVoiceModes.set(id, { mode, radius })
    this.net.voice?.setPeerMode(id, mode, radius)
    this.remotes.setVoiceMode(id, mode)
    useAppStore.getState().setPeerVoiceMode(id, mode)
    this.syncPeerRing(id)
  }

  /** リモートのウィスパー円。whisperモード×VC参加中(muted含む)のときだけ出す */
  private syncPeerRing(id: string): void {
    const mode = this.peerVoiceModes.get(id)
    const state = this.peerVoiceStates.get(id) ?? 'off'
    const show = mode?.mode === 'whisper' && state !== 'off'
    this.whisperRings.set(id, show && mode ? mode.radius : null)
  }

  private async connectNet(): Promise<void> {
    const { setNetStatus, setPeers, setSelfId, upsertPlayer, removePlayer } = useAppStore.getState()
    const identity = `user-${Math.random().toString(36).slice(2, 8)}`
    this.identity = identity
    setSelfId(identity)
    // ?room=xxx で入室先を切り替えられる(既定は現在のワールドid)
    const roomName = this.roomOverride ?? this.world?.id ?? FALLBACK_ROOM
    setNetStatus('接続中...')
    // 接続ごとに新しいクライアントを作り、再接続と競合した古い試行は破棄する
    const net = new NetClient()
    this.net = net
    try {
      await net.connect(
        roomName,
        identity,
        this.streamer.captureTrack(),
        {
          onRemoteVideo: (id, video) => this.remotes.setVideo(id, video),
          onRemoteMessage: (id, message) => {
            // システム参加者(ワールドボット)はプレイヤー扱いしない。
            // シーン系の権威更新は__worldからのみ受理する(詐称対策)
            if (isSystemId(id)) {
              if (id === WORLD_BOT_ID && isSceneAuthorityMessage(message)) {
                this.applySceneMessage(message)
              }
              return
            }
            // 入室済みの相手からのメッセージでプレイヤー一覧に載せる(joinイベントは新規参加者のみのため)
            upsertPlayer(id)
            if (message.t === 'pos') {
              const wasDead = this.remotes.isDead(id)
              this.remotes.applyMessage(id, message)
              if (wasDead !== this.remotes.isDead(id) && this.isSelectedPlayer(id)) {
                this.pushTargetToStore()
              }
            }
            if (message.t === 'act') {
              // エフェクトは補間中のリモート位置ではなく、送信側の実行時座標を原点にする
              this.spawnActionEffect(message.name, message)
              // 自分を対象にした回復は自分で適用する(HPはクライアント権威)
              if (message.name === 'heal' && message.tid === this.identity) {
                this.applyHeal(HEAL_RECEIVE_AMOUNT)
              }
            }
            // 他プレイヤーのHP・バフ(本人がクライアント権威で配る)。ターゲットHUD用
            if (message.t === 'stat') this.applyPeerStat(id, message)
            // 受信名は相手のクライアント改造に備えてこちらでもサニタイズする
            if (message.t === 'profile' && typeof message.name === 'string') {
              const name = sanitizeName(message.name)
              this.remotes.setName(id, name)
              upsertPlayer(id, name)
              if (this.isSelectedPlayer(id)) this.pushTargetToStore()
            }
            // 本文も送信側と同様にサニタイズする(相手のクライアント改造対策)
            if (message.t === 'chat' && typeof message.text === 'string') {
              const text = sanitizeChatText(message.text)
              if (text) {
                this.remotes.say(id, text)
                const from = sanitizeName(String(message.name ?? '')) || id
                useAppStore.getState().appendChat({ kind: 'chat', from, text })
              }
            }
            // 発話中表示(送信側のノイズゲート判定が正)
            if (message.t === 'spk') this.applyRemoteSpeaking(id, message.on === true)
            // 発音モード(減衰・遮断は受信側=こちらで行う)
            if (message.t === 'vmode') this.applyPeerVoiceMode(id, message)
          },
          // 後から入ってきた人は過去のprofile/spk/vmodeを受け取れないため、本人にだけ再送する
          onPeerJoined: (id) => {
            if (isSystemId(id)) return
            upsertPlayer(id)
            const name = this.displayName()
            if (name) this.net.sendReliable({ t: 'profile', name }, [id])
            this.sendStat([id])
            if (this.selfSpeaking) this.net.sendReliable({ t: 'spk', on: true }, [id])
            if (this.voiceMode !== 'normal') this.net.sendReliable(this.voiceModeMessage(), [id])
          },
          onRemoteLeft: (id) => {
            if (isSystemId(id)) return
            this.remotes.remove(id)
            this.peerStats.delete(id)
            removePlayer(id)
            // 選択中の相手が退室したら選択を自動解除する
            if (this.isSelectedPlayer(id)) this.pushTargetToStore()
            useAppStore.getState().setPeerVoice(id, 'off')
            this.applyRemoteSpeaking(id, false)
            this.peerVoiceModes.delete(id)
            this.peerVoiceStates.delete(id)
            this.whisperRings.set(id, null)
          },
          onPeersChanged: (count) => setPeers(count),
        },
        {
          onPeerVoiceChanged: (id, state) => {
            if (state === 'off') this.peerVoiceStates.delete(id)
            else this.peerVoiceStates.set(id, state)
            this.remotes.setVoiceState(id, state)
            useAppStore.getState().setPeerVoice(id, state)
            this.syncPeerRing(id)
          },
          onPlaybackBlocked: () => {
            useAppStore.getState().appendChat({
              kind: 'system',
              text: '音声がブロックされています。画面をクリックすると再開します',
            })
          },
        },
      )
      // dispose済み・別の接続に置き換わった後に完了した場合は切断する
      if (this.disposed || this.net !== net) {
        net.disconnect()
        return
      }
      setNetStatus(`接続中: ${roomName} (${identity})`)
      // 空でも送る(名前をクリアした場合の伝播)。再接続時もこの経路で再送される
      this.lastSentName = this.displayName()
      net.sendReliable({ t: 'profile', name: this.lastSentName })
      this.sendStat()
      // 保存済みマスター音量とセッション内の個別音量を新しい接続へ適用する
      const { voiceMasterVolume, playerVolumes } = useAppStore.getState()
      net.voice?.setMasterVolume(voiceMasterVolume)
      for (const [id, volume] of Object.entries(playerVolumes)) {
        net.voice?.setPlayerVolume(id, volume)
      }
    } catch (err) {
      if (this.disposed || this.net !== net) return
      setNetStatus(`オフライン (${err instanceof Error ? err.message : String(err)})`)
    }
  }

  /**
   * VRM読み込みを直列化する。復元と手動ドロップが並行すると
   * 完了順が不定になり古い方が勝ち得るため、必ずこのキューを通す。
   */
  private queueVRMLoad<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.vrmChain.then(fn)
    this.vrmChain = next.catch(() => {})
    return next
  }

  async loadVRMFile(file: File): Promise<void> {
    // 復元より先に立てる: 実行待ちの復元はこのフラグを見てスキップする
    this.userVRMRequested = true
    const { appendChat, setAvatarName } = useAppStore.getState()
    try {
      const data = await file.arrayBuffer()
      const name = await this.queueVRMLoad(() => this.avatar.loadVRM(data))
      setAvatarName(name)
      appendChat({ kind: 'system', text: `VRM「${name}」を読み込みました` })
      // 成功したVRMだけをキャッシュする(次回リロード時に自動復元)
      void saveCachedVRM(data)
    } catch (err) {
      appendChat({
        kind: 'error',
        text: `読み込み失敗: ${err instanceof Error ? err.message : String(err)}`,
      })
    }
  }

  /** 前回読み込んだVRMをIndexedDBから復元する。手動ドロップが先行したら何もしない */
  private async restoreCachedVRM(): Promise<void> {
    const data = await loadCachedVRM()
    if (!data) return
    const { appendChat, setAvatarName } = useAppStore.getState()
    try {
      const name = await this.queueVRMLoad(async () => {
        if (this.disposed || this.userVRMRequested) return null
        return await this.avatar.loadVRM(data)
      })
      if (name === null) return
      setAvatarName(name)
      appendChat({ kind: 'system', text: '前回のVRMを復元しました' })
    } catch {
      // 破損キャッシュはリロードの度に失敗し続けるため消す
      void clearCachedVRM()
      appendChat({ kind: 'error', text: 'VRMキャッシュの復元に失敗したため削除しました' })
    }
  }

  /** 配信元(R2)のVRMAをエモートとして再生する(初回のみ取得) */
  async playEmote(id: string): Promise<void> {
    const { appendChat } = useAppStore.getState()
    // エモートは倒れ姿勢(playHold)を上書きしてしまうため戦闘不能中は禁止
    if (this.dead) {
      appendChat({ kind: 'error', text: '戦闘不能中はエモートできません' })
      return
    }
    if (!this.avatar.hasVRM) {
      appendChat({ kind: 'error', text: '先にVRMを読み込んでください' })
      return
    }
    try {
      await this.avatar.playEmote(id, emoteUrl(id))
    } catch (err) {
      appendChat({
        kind: 'error',
        text: `エモート失敗: ${err instanceof Error ? err.message : String(err)}`,
      })
    }
  }

  /** .vrma / .fbx をドロップした場合。ファイル名(拡張子除く)がクリップ名になる */
  async loadAnimationFile(file: File, kind: AnimationFileKind): Promise<void> {
    const { appendChat } = useAppStore.getState()
    if (!this.avatar.hasVRM) {
      appendChat({ kind: 'error', text: '先にVRMを読み込んでください' })
      return
    }
    const name = file.name.replace(/\.[^.]+$/, '').toLowerCase()
    try {
      await this.avatar.loadAnimation(name, await file.arrayBuffer(), kind)
      appendChat({ kind: 'system', text: `アニメーション「${name}」を登録しました` })
    } catch (err) {
      appendChat({
        kind: 'error',
        text: `読み込み失敗: ${err instanceof Error ? err.message : String(err)}`,
      })
    }
  }

  /**
   * すべての操作の入口。右クリック・キーボード・ホットバー・マクロ・
   * チャット入力が同じ経路でコマンドを実行する。
   */
  readonly dispatch = async (line: string): Promise<void> => {
    const { appendChat } = useAppStore.getState()
    await this.registry.execute(line, {
      api: this.commandAPI,
      out: {
        print: (text) => appendChat({ kind: 'system', text }),
        error: (text) => appendChat({ kind: 'error', text }),
      },
      depth: 0,
    })
  }

  private readonly commandAPI: GameCommandAPI = {
    moveTo: (x, z) => this.moveTo(x, z),
    stop: () => this.stopMovement(),
    jump: () => this.avatar.jump(),
    performAction: (name, target, tid) => this.performAction(name, target, tid),
    heal: (target, amount) => this.heal(target, amount),
    playEmote: (id) => this.playEmote(id),
    respawn: () => this.respawn(),
    dash: () => this.dash(),
    setCameraFollow: (mode) => this.setCameraFollow(mode),
    snapCamera: () => {
      this.focus.copy(this.avatar.position)
    },
    setZoom: (zoom) => {
      this.zoomTarget = THREE.MathUtils.clamp(zoom, ZOOM_MIN, ZOOM_MAX)
    },
    getPosition: () => ({
      x: this.avatar.position.x,
      z: this.avatar.position.z,
      yaw: this.avatar.yaw,
    }),
    getCursorTarget: () => this.cursorGroundPoint(),
    // ネームプレート更新とprofile送信はstore購読(refreshNameplate)に一元化されている
    setName: (name) => useAppStore.getState().setPlayerName(name),
    sendChat: (text) => this.sendChat(text),
    setHudEditMode: (on) => useAppStore.getState().setHudEditMode(on),
    resetHudLayout: () => useAppStore.getState().resetHudLayout(),
    openSettings: () => useAppStore.getState().setSettingsOpen(true),
    openPalette: () => useAppStore.getState().setPaletteOpen(true),
    openPlayers: () => useAppStore.getState().setPlayersOpen(true),
    openVoice: () => useAppStore.getState().setVoiceOpen(true),
    setVoiceEnabled: async (mode) => {
      const voice = this.net.voice
      if (!voice) throw new Error('サーバーに接続していません')
      const target = mode === 'toggle' ? !voice.enabled : mode === 'on'
      await voice.setEnabled(target)
      this.syncSelfVoiceUI()
    },
    setMicEnabled: async (mode) => {
      const voice = this.net.voice
      if (!voice) throw new Error('サーバーに接続していません')
      if (!voice.enabled) throw new Error('先に /vc on でVCに参加してください')
      // targetは「マイクON(=非ミュート)にするか」
      const target = mode === 'toggle' ? voice.micMuted : mode === 'on'
      await voice.setMicMuted(!target)
      this.syncSelfVoiceUI()
    },
    setVoiceMode: (mode, radius) => this.applySelfVoiceMode(mode, radius),
    getVoiceMode: () => this.voiceMode,
    getWorlds: () => useAppStore.getState().worlds,
    getCurrentWorld: () => useAppStore.getState().world,
    switchWorld: (id) => this.switchWorld(id),
    interact: (id) => this.interactNode(id),
    approachTarget: (target, range, command) =>
      this.startApproach('skill', target, range, target.radius, command),
    selectTarget: (id) => this.selectTarget(id),
    acquireTarget: () => this.acquireTarget(),
    acquireSelf: () => this.acquireSelf(),
    focusChat: () => useAppStore.getState().requestChatFocus(),
    openVrmPicker: () => useAppStore.getState().requestVrmPicker(),
    clearVrmCache: () => {
      void clearCachedVRM().then(() =>
        useAppStore
          .getState()
          .appendChat({ kind: 'system', text: 'キャッシュしたVRMを削除しました' }),
      )
    },
    getRenderStats: () => {
      const info = this.renderer.info
      return [
        `draw calls: ${info.render.calls} / triangles: ${info.render.triangles}`,
        `programs: ${info.programs?.length ?? 0} / geometries: ${info.memory.geometries} / textures: ${info.memory.textures}`,
        `markers: ${this.markers.length}`,
      ]
    },
  }

  /** A*経路探索して移動を開始する。戦闘不能中・到達不能(またはワールド未読込)ならfalse */
  moveTo(x: number, z: number): boolean {
    this.pendingApproach = null
    if (this.dead) return false
    if (!this.navGrid) return false
    const path = this.navGrid.findPath(
      { x: this.avatar.position.x, z: this.avatar.position.z },
      { x, z },
    )
    if (!path || path.length === 0) return false

    this.avatar.setPath(path.map((p) => new THREE.Vector3(p.x, 0, p.z)))
    const dest = path[path.length - 1]
    this.addMarker(new THREE.Vector3(dest.x, 0, dest.z))
    return true
  }

  /** 移動と自動接近を中止する */
  private stopMovement(): void {
    this.pendingApproach = null
    this.avatar.setPath([])
  }

  /**
   * 射程外の対象へ自動接近を開始する。射程に入るとcommandを再実行する。
   * 対象位置へ経路探索し(塞がったセルはfindPathが最寄りの通行可能セルへ吸着)、
   * 経路の終端ではなく毎フレームの射程判定(updateApproach)で早期に停止・発動する
   */
  private startApproach(
    kind: 'skill' | 'interact',
    target: TargetRef,
    range: number,
    radius: number,
    command: string,
  ): boolean {
    const pos = this.approachGoal(target)
    if (!pos) return false
    if (!this.moveTo(pos.x, pos.z)) return false // 先頭でpendingApproachもクリアされる
    this.pendingApproach = { kind, target, range, radius, command, goal: { x: pos.x, z: pos.z } }
    return true
  }

  /**
   * 自動接近の目標座標。ノードはワールド座標(interact対象はtargetable不問なので
   * describeTargetを使わない)、プレイヤーは表示位置。消えた・倒れた対象はnull
   */
  private approachGoal(target: TargetRef): { x: number; z: number } | null {
    if (target.kind === 'node') {
      const node = this.sceneRenderer?.getNode(target.id)
      if (!node || node.visible === false) return null
      return this.sceneRenderer?.worldPosition(target.id) ?? null
    }
    const described = this.describeTarget(target)
    return described?.alive ? { x: described.x, z: described.z } : null
  }

  /** 自動接近の毎フレーム判定。射程に入った瞬間に停止してコマンドを再実行する */
  private updateApproach(): void {
    const pending = this.pendingApproach
    if (!pending) return
    const pos = this.approachGoal(pending.target)
    if (!pos) {
      // 接近中に対象が消えた(despawn・撃破・退室・戦闘不能)
      this.pendingApproach = null
      useAppStore.getState().appendChat({ kind: 'error', text: '対象がいなくなりました' })
      return
    }
    const dist = Math.hypot(pos.x - this.avatar.position.x, pos.z - this.avatar.position.z)
    if (dist - pending.radius <= pending.range) {
      // 経路の終端まで歩かず、射程に入った瞬間に停止して発動する(行き過ぎ防止)
      this.pendingApproach = null
      this.avatar.setPath([])
      void this.dispatch(pending.command)
      return
    }
    if (Math.hypot(pos.x - pending.goal.x, pos.z - pending.goal.z) > APPROACH_REPATH_DIST) {
      // 対象が動いた: 経路を引き直して追跡する
      if (
        !this.startApproach(
          pending.kind,
          pending.target,
          pending.range,
          pending.radius,
          pending.command,
        )
      ) {
        useAppStore.getState().appendChat({ kind: 'error', text: 'そこへは到達できません' })
      }
      return
    }
    if (!this.avatar.isMoving) {
      // 経路を歩き切っても射程外(到達できる最寄り地点が遠い)
      this.pendingApproach = null
      useAppStore.getState().appendChat({ kind: 'error', text: 'それ以上近づけません' })
    }
  }

  private sendPosition(delta: number): void {
    if (!this.net.connected) return
    this.posAccum += delta
    if (this.posAccum < POS_SEND_INTERVAL) return
    this.posAccum %= POS_SEND_INTERVAL
    this.net.sendLossy({
      t: 'pos',
      x: this.avatar.position.x,
      y: this.avatar.position.y,
      z: this.avatar.position.z,
      yaw: this.avatar.yaw,
      moving: this.avatar.isMoving,
      // 生存中は省略(旧クライアント互換)。サーバーはdead中の自分を索敵から外す
      ...(this.dead ? { dead: true } : {}),
    })
  }

  /** アクション定義を追加する(プラグイン登録点) */
  registerAction(action: ActionDef): void {
    this.actions.set(action.name, action)
  }

  /**
   * アクションを実行し、他ユーザーへ通知する。
   * VRM未読込でもエフェクトだけは成立させる(クリップ再生は自動でスキップ)。
   */
  performAction(name: string, target?: { x: number; z: number }, tid?: string): void {
    if (this.dead) return
    // 実際に発動したアクションは進行中の自動接近を上書きする
    this.pendingApproach = null
    const action = this.actions.get(name)
    if (!action) return
    if (action.stopsMovement) this.avatar.setPath([])
    if (target) this.avatar.faceTowards(target.x, target.z)
    if (action.clip) this.avatar.playActionClip(action.clip)

    const x = this.avatar.position.x
    const z = this.avatar.position.z
    const yaw = this.avatar.yaw
    const tx = action.needsTarget ? (target?.x ?? x) : undefined
    const tz = action.needsTarget ? (target?.z ?? z) : undefined
    this.spawnActionEffect(name, { x, z, yaw, tx, tz })
    // tid=対象指定スキルの対象ノードid(サーバーがtargetable/射程を検証する)
    this.net.sendReliable({ t: 'act', name, x, z, yaw, tx, tz, tid })
  }

  /**
   * チャットを送信する。performActionと同じ対称パターン:
   * ローカルで即時表示(吹き出し+ログ)しつつ、全員へ配信する。
   * オフライン時はsendReliableがno-opになり、ローカル表示だけ成立する。
   */
  sendChat(text: string): void {
    const clean = sanitizeChatText(text)
    if (!clean) return
    const name = this.displayName()
    this.avatar.say(clean)
    useAppStore.getState().appendChat({ kind: 'chat', from: name || this.identity, text: clean })
    this.net.sendReliable({ t: 'chat', name, text: clean })
  }

  private spawnActionEffect(
    name: string,
    at: { x: number; z: number; yaw: number; tx?: number; tz?: number },
  ): void {
    const effect = this.actions.get(name)?.effect
    if (!effect) return
    this.effects.spawn({ kind: effect, ...at })
  }

  dispose(): void {
    this.disposed = true
    this.unsubscribeStore()
    useAppStore.getState().setDispatch(null)
    this.net.disconnect()
    this.targetRing.clear()
    this.effects.dispose()
    this.sceneRenderer?.dispose()
    this.streamer.dispose()
    this.renderer.setAnimationLoop(null)
    this.renderer.domElement.removeEventListener('contextmenu', this.onContextMenu)
    this.renderer.domElement.removeEventListener('click', this.onClick)
    this.renderer.domElement.removeEventListener('wheel', this.onWheel)
    this.renderer.domElement.removeEventListener('mousemove', this.onMouseMove)
    this.renderer.domElement.removeEventListener('mouseleave', this.onMouseLeave)
    this.renderer.domElement.removeEventListener('mousedown', this.onMouseDown)
    window.removeEventListener('mousedown', this.suppressNavButtons, { capture: true })
    window.removeEventListener('mouseup', this.suppressNavButtons, { capture: true })
    window.removeEventListener('auxclick', this.suppressNavButtons, { capture: true })
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('pagehide', this.onPageHide)
    this.resizeObserver.disconnect()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }

  private setupLights(): void {
    // 2Dルックなのでシャドウマップは使わず、VRMの陰影用にライトだけ置く
    // 配信キャプチャのカメラにも当たるようAVATAR_LAYERを有効化する
    const hemi = new THREE.HemisphereLight(0xdfeaff, 0x8a9a78, 1.2)
    hemi.layers.enable(AVATAR_LAYER)
    this.scene.add(hemi)
    const sun = new THREE.DirectionalLight(0xffffff, 1.6)
    sun.position.set(20, 40, 25)
    sun.layers.enable(AVATAR_LAYER)
    this.scene.add(sun)
  }

  private onMouseMove = (event: MouseEvent): void => {
    const rect = this.renderer.domElement.getBoundingClientRect()
    this.pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  private onMouseLeave = (): void => {
    this.pointer = null
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    // チャット欄などの入力中はゲーム操作を発火しない
    const target = event.target
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return
    const state = useAppStore.getState()
    // HUD編集モード中はゲーム操作を止める(Escapeでの終了はバナー側が担当)
    if (state.hudEditMode) return

    // ホットバーのカスタムバインドを優先(修飾キー込み完全一致)。表示中のバーのみ
    // Space(ジャンプ)やEnter(チャット入力)も固定キーではなく
    // デフォルトホットバーのキー割当としてここで発火する
    if (this.fireHotbarBind(event)) event.preventDefault()
  }

  /** アクティブなホットバーからバインド一致スロットを探して発火する。一致があればtrue */
  private fireHotbarBind(
    input: Pick<KeyboardEvent, 'code' | 'shiftKey' | 'ctrlKey' | 'altKey'>,
  ): boolean {
    for (const hotbar of useAppStore.getState().hotbars) {
      if (!hotbar.active) continue
      const index = hotbar.keys.findIndex((bind) => bind && matchKeybind(bind, input))
      if (index >= 0) {
        const slot = hotbar.slots[index]
        if (slot) void this.dispatch(slot.command)
        return true
      }
    }
    return false
  }

  /** マウスの中/サイド/右ボタンのバインド発火。左は対象選択・インタラクト専用で対象外 */
  private onMouseDown = (event: MouseEvent): void => {
    if (event.button === 0) return
    if (useAppStore.getState().hudEditMode) return
    const fired = this.fireHotbarBind({
      code: mouseCode(event.button),
      shiftKey: event.shiftKey,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
    })
    if (!fired) return
    event.preventDefault()
    // 右ボタンにバインドした場合は既定の右クリック移動を上書きする
    if (event.button === 2) this.suppressNextContextMenu = true
  }

  /**
   * 戻る/進むボタンにバインドがある間、ブラウザの履歴移動を抑止する。
   * 発動タイミング(mousedown/mouseup/auxclick)がブラウザごとに違うため全部叩き、
   * HUD上にカーソルがあっても効くようwindowのcaptureフェーズで受ける
   */
  private suppressNavButtons = (event: MouseEvent): void => {
    if (event.button < 3) return
    const bound = useAppStore
      .getState()
      .hotbars.some((h) => h.active && h.keys.some((b) => b?.code === mouseCode(event.button)))
    if (bound) event.preventDefault()
  }

  /** カメラ追従(on) / カメラ固定(off)を切り替える。追従にした瞬間はスナップする */
  setCameraFollow(mode: 'on' | 'off' | 'toggle'): void {
    this.followAvatar = mode === 'toggle' ? !this.followAvatar : mode === 'on'
    if (this.followAvatar) this.focus.copy(this.avatar.position)
    useAppStore.getState().setCameraFollow(this.followAvatar)
  }

  /** カメラ固定モード中、カーソルが画面端にあるとその方向へ視界をスクロールする */
  private updateEdgePan(delta: number): void {
    if (this.followAvatar || !this.pointer) return
    const { clientWidth, clientHeight } = this.container
    let dx = 0
    let dz = 0
    if (this.pointer.x < EDGE_MARGIN) dx -= 1
    else if (this.pointer.x > clientWidth - EDGE_MARGIN) dx += 1
    if (this.pointer.y < EDGE_MARGIN) dz -= 1
    else if (this.pointer.y > clientHeight - EDGE_MARGIN) dz += 1
    if (dx === 0 && dz === 0) return

    const speed = (this.zoom * EDGE_PAN_SPEED * delta) / Math.hypot(dx, dz)
    // カメラは-Z方向を見下ろす固定アングルなので、画面上=ワールド-Z、画面右=+X
    this.focus.x = THREE.MathUtils.clamp(this.focus.x + dx * speed, -PAN_LIMIT, PAN_LIMIT)
    this.focus.z = THREE.MathUtils.clamp(this.focus.z + dz * speed, -PAN_LIMIT, PAN_LIMIT)
  }

  private onWheel = (event: WheelEvent): void => {
    event.preventDefault()
    this.zoomTarget = THREE.MathUtils.clamp(
      this.zoomTarget * 1.0015 ** event.deltaY,
      ZOOM_MIN,
      ZOOM_MAX,
    )
  }

  private onContextMenu = (event: MouseEvent): void => {
    event.preventDefault()
    if (this.suppressNextContextMenu) {
      this.suppressNextContextMenu = false
      return
    }
    const hit = this.groundPointAt(event.clientX, event.clientY)
    if (!hit) return
    // 右クリック移動もコマンド経由(すべての操作をコマンドに統一)
    void this.dispatch(`/move ${hit.x.toFixed(2)} ${hit.z.toFixed(2)}`)
  }

  /**
   * 左クリック: 対象可能エンティティ・プレイヤー・自分なら/target(選択)、
   * インタラクト可能なら/interactを発行する(両属性持ちは両方)。何もない場所のクリックは選択解除。
   * レイキャストは子(ビジュアル)に当たるため、属性を持つ最近傍祖先へ解決する
   */
  private onClick = (event: MouseEvent): void => {
    const renderer = this.sceneRenderer
    const picked = renderer ? this.pickAt(event.clientX, event.clientY) : null
    if (!picked) {
      if (this.selectedTarget) void this.dispatch('/target clear')
      return
    }
    if (picked.kind === 'player') {
      void this.dispatch(`/target ${picked.id}`)
      return
    }
    if (picked.kind === 'self') {
      void this.dispatch('/target self')
      return
    }
    const targetId = renderer?.findAncestorWith(picked.id, 'targetable')
    if (targetId) void this.dispatch(`/target ${targetId}`)
    const interactId = renderer?.findAncestorWith(picked.id, 'interactable')
    if (interactId) void this.dispatch(`/interact ${interactId}`)
  }

  /**
   * スクリーン座標直下のもの(地面以外)。シーンノード(id=ヒットしたノード。属性解決は
   * 呼び出し側)、他プレイヤー(id=identity)、自分のアバターのうち最も手前のもの。何もなければnull
   */
  private pickAt(clientX: number, clientY: number): PickResult | null {
    const renderer = this.sceneRenderer
    if (!renderer) return null
    const rect = this.renderer.domElement.getBoundingClientRect()
    const pointer = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    )
    this.raycaster.setFromCamera(pointer, this.camera)
    const objects = [
      ...renderer.raycastTargets(),
      ...this.remotes.raycastTargets(),
      this.avatar.root,
    ]
    // intersectObjectsは距離昇順。非表示(映像未着のビルボード等)は飛ばす
    for (const hit of this.raycaster.intersectObjects(objects, true)) {
      if (!hit.object.visible) continue
      const nodeId = hit.object.userData.nodeId
      if (typeof nodeId === 'string') return { kind: 'node', id: nodeId }
      // プレイヤー・自分は祖先を辿って判定する(ビルボード・影・ネームプレートが子にいる)
      for (let o: THREE.Object3D | null = hit.object; o; o = o.parent) {
        if (o === this.avatar.root) return { kind: 'self', id: this.identity }
        const peerId = o.userData.peerId
        if (typeof peerId === 'string') return { kind: 'player', id: peerId }
      }
    }
    return null
  }

  /** 現在のマウスカーソル直下の地面座標。方向指定スキルの狙い先に使う */
  private cursorGroundPoint(): { x: number; z: number } | null {
    if (!this.pointer) return null
    const rect = this.renderer.domElement.getBoundingClientRect()
    return this.groundPointAt(this.pointer.x + rect.left, this.pointer.y + rect.top)
  }

  /** スクリーン座標から地面上のワールド座標を求める */
  private groundPointAt(clientX: number, clientY: number): { x: number; z: number } | null {
    const rect = this.renderer.domElement.getBoundingClientRect()
    const pointer = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    )
    this.raycaster.setFromCamera(pointer, this.camera)
    const ground = this.sceneRenderer?.ground
    if (!ground) return null
    const hit = this.raycaster.intersectObject(ground, false)[0]
    return hit ? { x: hit.point.x, z: hit.point.z } : null
  }

  private addMarker(point: THREE.Vector3): void {
    // ジオメトリは毎回同一形状なので共有、マテリアルはプールから
    // (disposeするとシェーダー再コンパイルが起きるため使い回す)
    const mesh = new THREE.Mesh(MARKER_GEOMETRY, acquireFlatMaterial(0xffe066))
    mesh.rotation.x = -Math.PI / 2
    mesh.position.copy(point)
    mesh.position.y += 0.04
    this.scene.add(mesh)
    this.markers.push({ mesh, age: 0 })
  }

  private updateMarkers(delta: number): void {
    for (let i = this.markers.length - 1; i >= 0; i--) {
      const marker = this.markers[i]
      marker.age += delta
      const t = marker.age / MARKER_LIFETIME
      if (t >= 1) {
        this.scene.remove(marker.mesh)
        releaseFlatMaterial(marker.mesh.material as THREE.MeshBasicMaterial)
        this.markers.splice(i, 1)
        continue
      }
      marker.mesh.scale.setScalar(1 + t * 1.5)
      ;(marker.mesh.material as THREE.MeshBasicMaterial).opacity = 1 - t
    }
  }

  /** 現在のマイク入力レベル(RMS)。設定パネルのメーターがrAFで直接読む(store経由だと再レンダ嵐) */
  getMicLevel(): number {
    return this.net.voice?.micLevel() ?? 0
  }

  /** マイクデバイスを切り替えて保存する(設定パネルから)。VC OFF中でも次回のONに効く */
  async setMicDevice(deviceId: string): Promise<void> {
    saveMicDeviceId(deviceId)
    const voice = this.net.voice
    if (!voice) return
    const ok = await voice.switchMicDevice(deviceId).catch(() => false)
    if (!ok) {
      useAppStore.getState().appendChat({ kind: 'error', text: 'マイクの切り替えに失敗しました' })
    }
  }

  private tick = (): void => {
    const delta = Math.min(this.clock.getDelta(), 0.1)

    // 空間音響(リスナー・音源位置)と口パクの更新。アバター描画前に反映する
    const voice = this.net.voice
    const mouth = voice?.update(delta, this.avatar.position, this.remotes.positions()) ?? 0
    this.avatar.setMouthOpen(mouth)
    // 自分の発話中表示はSFU判定を待たずローカルのマイク音量で即時反映する
    this.applySelfSpeaking(voice?.selfSpeaking ?? false)

    this.avatar.update(delta)
    this.updateSelfBuffs()
    this.updateApproach()
    this.updateMarkers(delta)
    this.effects.update(delta)
    this.sceneRenderer?.update(delta) // 動的ノードの位置パッチ補間
    this.updateTargetRing()
    this.whisperRings.update(SELF_RING_ID, this.avatar.position, this.remotes.positions())
    this.remotes.update(delta, this.camera.quaternion)
    this.streamer.update(delta, this.scene, this.avatar.position, CAMERA_DIR)
    this.sendPosition(delta)
    this.updateHudPosition(delta)

    // ズームとカメラ追従を滑らかに補間
    this.zoom += (this.zoomTarget - this.zoom) * Math.min(1, 10 * delta)
    this.updateEdgePan(delta)
    if (this.followAvatar) {
      this.focus.lerp(this.avatar.position, 1 - Math.exp(-8 * delta))
    }
    this.updateCamera()
    this.updateProjection()

    this.renderer.render(this.scene, this.camera)
  }

  /** HUDの座標表示をスロットル付きで更新する */
  private updateHudPosition(delta: number): void {
    this.hudPosAccum += delta
    if (this.hudPosAccum < HUD_POS_INTERVAL) return
    this.hudPosAccum %= HUD_POS_INTERVAL
    const { position, setPosition } = useAppStore.getState()
    const x = this.avatar.position.x
    const z = this.avatar.position.z
    if (Math.abs(position.x - x) > 0.05 || Math.abs(position.z - z) > 0.05) {
      setPosition({ x, z })
    }
  }

  private updateCamera(): void {
    const target = this.focus.clone()
    target.y += 1
    this.camera.position.copy(target).addScaledVector(CAMERA_DIR, CAMERA_DISTANCE)
    this.camera.lookAt(target)
  }

  private updateProjection(): void {
    const { clientWidth, clientHeight } = this.container
    if (clientWidth === 0 || clientHeight === 0) return
    const aspect = clientWidth / clientHeight
    this.camera.left = -this.zoom * aspect
    this.camera.right = this.zoom * aspect
    this.camera.top = this.zoom
    this.camera.bottom = -this.zoom
    this.camera.updateProjectionMatrix()
  }

  private resize(): void {
    const { clientWidth, clientHeight } = this.container
    if (clientWidth === 0 || clientHeight === 0) return
    this.renderer.setSize(clientWidth, clientHeight)
    this.updateProjection()
  }
}
