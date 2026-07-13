import * as THREE from 'three'
import { Avatar } from '../avatar/Avatar'
import { AvatarStreamer } from '../avatar/AvatarStreamer'
import type { AnimationFileKind } from '../avatar/animationLoaders'
import { AVATAR_LAYER } from '../avatar/captureSpec'
import { clearCachedVRM, loadCachedVRM, saveCachedVRM } from '../avatar/vrmCache'
import { registerBuiltins } from '../command/builtins'
import { CommandRegistry } from '../command/CommandRegistry'
import { MacroStore, wireMacros } from '../command/macros'
import type { GameCommandAPI } from '../command/types'
import { NetClient } from '../net/NetClient'
import { sanitizeChatText, sanitizeName } from '../net/protocol'
import { matchKeybind } from '../state/keybinds'
import { useAppStore } from '../state/store'
import { type ActionDef, BUILTIN_ACTIONS } from './actions'
import { EffectSystem } from './EffectSystem'
import { registerBuiltinEffects } from './effects'
import { buildMap } from './GroundMap'
import { buildNavGrid, SPAWN } from './MapDef'
import type { NavGrid } from './pathfinding'
import { RemoteAvatars } from './RemoteAvatars'

// 平行投影の固定アングル(LoL風の2Dルック)。仰角 約42°
const CAMERA_DIR = new THREE.Vector3(0, 0.9, 1).normalize()
const CAMERA_DISTANCE = 60
const ZOOM_MIN = 0.7 // 画面半分の高さ(ワールド単位)。小さいほど寄る(顔が見えるくらい)
const ZOOM_MAX = 32 // マップ全体が見渡せる
const ZOOM_DEFAULT = 9
const MARKER_LIFETIME = 0.6 // 秒
const ROOM_NAME = 'square'
const POS_SEND_INTERVAL = 1 / 15 // 秒
const HUD_POS_INTERVAL = 0.2 // 秒。HUDの座標表示更新(毎フレームはReact再レンダ嵐になる)
const EDGE_MARGIN = 32 // px。この幅にカーソルが入るとその方向へスクロール
const EDGE_PAN_SPEED = 2.0 // ズーム(半画面高さ)1あたりの移動速度(unit/s)
const PAN_LIMIT = 28 // 視点移動できる範囲(マップ端まで)

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
  private readonly ground: THREE.Mesh
  private readonly navGrid: NavGrid
  private readonly markers: ClickMarker[] = []
  private readonly resizeObserver: ResizeObserver
  private zoom = ZOOM_DEFAULT
  private zoomTarget = ZOOM_DEFAULT
  private readonly focus = new THREE.Vector3()
  private followAvatar = true
  private pointer: { x: number; y: number } | null = null
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

  constructor(container: HTMLElement) {
    this.container = container

    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    container.appendChild(this.renderer.domElement)

    this.scene.background = new THREE.Color(0x25381f)
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200)

    const map = buildMap()
    this.scene.add(map.group)
    this.ground = map.ground
    this.navGrid = buildNavGrid() // マップは静的なので起動時に事前計算

    this.setupLights()
    this.avatar = new Avatar(this.scene)
    this.avatar.position.set(SPAWN.x, 0, SPAWN.z)
    this.remotes = new RemoteAvatars(this.scene)
    this.effects = new EffectSystem(this.scene)
    registerBuiltinEffects(this.effects)
    for (const action of BUILTIN_ACTIONS) this.actions.set(action.name, action)

    registerBuiltins(this.registry, this.macroStore)
    wireMacros(this.registry, this.macroStore)
    this.macroStore.onChange = () => useAppStore.getState().bumpMacros()
    useAppStore.getState().setDispatch(this.dispatch)

    // 表示名(プレイヤー名 > VRM名)の変化でネームプレート更新+profile送信
    this.unsubscribeStore = useAppStore.subscribe((state, prev) => {
      if (state.playerName !== prev.playerName || state.avatarName !== prev.avatarName) {
        this.refreshNameplate()
      }
    })
    this.refreshNameplate()

    this.focus.copy(this.avatar.position)
    this.updateCamera()

    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(container)
    this.resize()

    this.renderer.domElement.addEventListener('contextmenu', this.onContextMenu)
    this.renderer.domElement.addEventListener('wheel', this.onWheel, { passive: false })
    this.renderer.domElement.addEventListener('mousemove', this.onMouseMove)
    this.renderer.domElement.addEventListener('mouseleave', this.onMouseLeave)
    window.addEventListener('keydown', this.onKeyDown)
    // リロード・タブ閉じ時に明示的に切断する(接続処理との競合による内部エラー防止)
    window.addEventListener('pagehide', this.onPageHide)
  }

  private readonly onPageHide = (): void => {
    this.net.disconnect()
  }

  start(): void {
    this.renderer.setAnimationLoop(this.tick)
    void this.connectNet()
    void this.restoreCachedVRM()
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

  /** エンドポイント変更時などに接続を張り直す */
  async reconnect(): Promise<void> {
    this.net.disconnect()
    this.remotes.clear()
    useAppStore.getState().setPeers(0)
    await this.connectNet()
  }

  private async connectNet(): Promise<void> {
    const { setNetStatus, setPeers } = useAppStore.getState()
    const identity = `user-${Math.random().toString(36).slice(2, 8)}`
    this.identity = identity
    // ?room=xxx で入室先を切り替えられる(既定はsquare)
    const roomName = new URLSearchParams(location.search).get('room') ?? ROOM_NAME
    setNetStatus('接続中...')
    // 接続ごとに新しいクライアントを作り、再接続と競合した古い試行は破棄する
    const net = new NetClient()
    this.net = net
    try {
      await net.connect(roomName, identity, this.streamer.captureTrack(), {
        onRemoteVideo: (id, video) => this.remotes.setVideo(id, video),
        onRemoteMessage: (id, message) => {
          if (message.t === 'pos') this.remotes.applyMessage(id, message)
          // エフェクトは補間中のリモート位置ではなく、送信側の実行時座標を原点にする
          if (message.t === 'act') this.spawnActionEffect(message.name, message)
          // 受信名は相手のクライアント改造に備えてこちらでもサニタイズする
          if (message.t === 'profile' && typeof message.name === 'string') {
            this.remotes.setName(id, sanitizeName(message.name))
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
        },
        // 後から入ってきた人は過去のprofileを受け取れないため、本人にだけ再送する
        onPeerJoined: (id) => {
          const name = this.displayName()
          if (name) this.net.sendReliable({ t: 'profile', name }, [id])
        },
        onRemoteLeft: (id) => this.remotes.remove(id),
        onPeersChanged: (count) => setPeers(count),
      })
      // dispose済み・別の接続に置き換わった後に完了した場合は切断する
      if (this.disposed || this.net !== net) {
        net.disconnect()
        return
      }
      setNetStatus(`接続中: ${roomName} (${identity})`)
      // 空でも送る(名前をクリアした場合の伝播)。再接続時もこの経路で再送される
      this.lastSentName = this.displayName()
      net.sendReliable({ t: 'profile', name: this.lastSentName })
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
    const { setStatus, setAvatarName } = useAppStore.getState()
    setStatus('VRMを読み込み中...')
    try {
      const data = await file.arrayBuffer()
      const name = await this.queueVRMLoad(() => this.avatar.loadVRM(data))
      setAvatarName(name)
      setStatus('')
      // 成功したVRMだけをキャッシュする(次回リロード時に自動復元)
      void saveCachedVRM(data)
    } catch (err) {
      setStatus(`読み込み失敗: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /** 前回読み込んだVRMをIndexedDBから復元する。手動ドロップが先行したら何もしない */
  private async restoreCachedVRM(): Promise<void> {
    const data = await loadCachedVRM()
    if (!data) return
    const { setStatus, setAvatarName } = useAppStore.getState()
    try {
      const name = await this.queueVRMLoad(async () => {
        if (this.disposed || this.userVRMRequested) return null
        setStatus('前回のVRMを復元中...')
        return await this.avatar.loadVRM(data)
      })
      if (name === null) return
      setAvatarName(name)
      setStatus('前回のVRMを復元しました')
    } catch {
      // 破損キャッシュはリロードの度に失敗し続けるため消す
      void clearCachedVRM()
      setStatus('VRMキャッシュの復元に失敗したため削除しました')
    }
  }

  /** public/animations/ のVRMAをエモートとして再生する(初回のみ取得) */
  async playEmote(id: string): Promise<void> {
    const { setStatus } = useAppStore.getState()
    if (!this.avatar.hasVRM) {
      setStatus('先にVRMを読み込んでください')
      return
    }
    try {
      await this.avatar.playEmote(id, `/animations/${id}.vrma`)
    } catch (err) {
      setStatus(`エモート失敗: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /** .vrma / .fbx をドロップした場合。ファイル名(拡張子除く)がクリップ名になる */
  async loadAnimationFile(file: File, kind: AnimationFileKind): Promise<void> {
    const { setStatus } = useAppStore.getState()
    if (!this.avatar.hasVRM) {
      setStatus('先にVRMを読み込んでください')
      return
    }
    const name = file.name.replace(/\.[^.]+$/, '').toLowerCase()
    setStatus(`アニメーション「${name}」を読み込み中...`)
    try {
      await this.avatar.loadAnimation(name, await file.arrayBuffer(), kind)
      setStatus(`アニメーション「${name}」を登録しました`)
    } catch (err) {
      setStatus(`読み込み失敗: ${err instanceof Error ? err.message : String(err)}`)
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
    stop: () => this.avatar.setPath([]),
    jump: () => this.avatar.jump(),
    performAction: (name, target) => this.performAction(name, target),
    playEmote: (id) => this.playEmote(id),
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
    // ネームプレート更新とprofile送信はstore購読(refreshNameplate)に一元化されている
    setName: (name) => useAppStore.getState().setPlayerName(name),
    sendChat: (text) => this.sendChat(text),
    setHudEditMode: (on) => useAppStore.getState().setHudEditMode(on),
    resetHudLayout: () => useAppStore.getState().resetHudLayout(),
  }

  /** A*経路探索して移動を開始する。到達不能ならfalse */
  moveTo(x: number, z: number): boolean {
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
  performAction(name: string, target?: { x: number; z: number }): void {
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
    this.net.sendReliable({ t: 'act', name, x, z, yaw, tx, tz })
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
    this.effects.dispose()
    this.streamer.dispose()
    this.renderer.setAnimationLoop(null)
    this.renderer.domElement.removeEventListener('contextmenu', this.onContextMenu)
    this.renderer.domElement.removeEventListener('wheel', this.onWheel)
    this.renderer.domElement.removeEventListener('mousemove', this.onMouseMove)
    this.renderer.domElement.removeEventListener('mouseleave', this.onMouseLeave)
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

    // ホットバーのカスタムバインドを優先(修飾キー込み完全一致)
    const index = state.hotbarKeys.findIndex((bind) => bind && matchKeybind(bind, event))
    if (index >= 0) {
      event.preventDefault()
      const slot = state.hotbar[index]
      if (slot) void this.dispatch(slot.command)
      return
    }

    if (event.code === 'Space') {
      event.preventDefault()
      void this.dispatch('/jump')
    } else if (event.code === 'KeyY') {
      void this.dispatch('/camera toggle')
    }
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
    const hit = this.groundPointAt(event.clientX, event.clientY)
    if (!hit) return
    // 右クリック移動もコマンド経由(すべての操作をコマンドに統一)
    void this.dispatch(`/move ${hit.x.toFixed(2)} ${hit.z.toFixed(2)}`)
  }

  /** スクリーン座標から地面上のワールド座標を求める */
  private groundPointAt(clientX: number, clientY: number): { x: number; z: number } | null {
    const rect = this.renderer.domElement.getBoundingClientRect()
    const pointer = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    )
    this.raycaster.setFromCamera(pointer, this.camera)
    const hit = this.raycaster.intersectObject(this.ground, false)[0]
    return hit ? { x: hit.point.x, z: hit.point.z } : null
  }

  private addMarker(point: THREE.Vector3): void {
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(0.25, 0.35, 32),
      new THREE.MeshBasicMaterial({
        color: 0xffe066,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    )
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
        marker.mesh.geometry.dispose()
        ;(marker.mesh.material as THREE.Material).dispose()
        this.markers.splice(i, 1)
        continue
      }
      marker.mesh.scale.setScalar(1 + t * 1.5)
      ;(marker.mesh.material as THREE.MeshBasicMaterial).opacity = 1 - t
    }
  }

  private tick = (): void => {
    const delta = Math.min(this.clock.getDelta(), 0.1)

    this.avatar.update(delta)
    this.updateMarkers(delta)
    this.effects.update(delta)
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
