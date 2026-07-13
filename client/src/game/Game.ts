import * as THREE from 'three'
import { Avatar } from '../avatar/Avatar'
import { AvatarStreamer } from '../avatar/AvatarStreamer'
import type { AnimationFileKind } from '../avatar/animationLoaders'
import { AVATAR_LAYER } from '../avatar/captureSpec'
import { NetClient } from '../net/NetClient'
import { useAppStore } from '../state/store'
import { buildMap } from './GroundMap'
import { buildNavGrid } from './MapDef'
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
  private net = new NetClient()
  private posAccum = 0
  private disposed = false

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
    this.remotes = new RemoteAvatars(this.scene)

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
  }

  start(): void {
    this.renderer.setAnimationLoop(this.tick)
    void this.connectNet()
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
    } catch (err) {
      if (this.disposed || this.net !== net) return
      setNetStatus(`オフライン (${err instanceof Error ? err.message : String(err)})`)
    }
  }

  async loadVRMFile(file: File): Promise<void> {
    const { setStatus, setAvatarName } = useAppStore.getState()
    setStatus('VRMを読み込み中...')
    try {
      const name = await this.avatar.loadVRM(await file.arrayBuffer())
      setAvatarName(name)
      setStatus('')
    } catch (err) {
      setStatus(`読み込み失敗: ${err instanceof Error ? err.message : String(err)}`)
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

  private sendPosition(delta: number): void {
    if (!this.net.connected) return
    this.posAccum += delta
    if (this.posAccum < POS_SEND_INTERVAL) return
    this.posAccum %= POS_SEND_INTERVAL
    this.net.sendLossy({
      t: 'pos',
      x: this.avatar.position.x,
      z: this.avatar.position.z,
      yaw: this.avatar.yaw,
      moving: this.avatar.isMoving,
    })
  }

  dispose(): void {
    this.disposed = true
    this.net.disconnect()
    this.streamer.dispose()
    this.renderer.setAnimationLoop(null)
    this.renderer.domElement.removeEventListener('contextmenu', this.onContextMenu)
    this.renderer.domElement.removeEventListener('wheel', this.onWheel)
    this.renderer.domElement.removeEventListener('mousemove', this.onMouseMove)
    this.renderer.domElement.removeEventListener('mouseleave', this.onMouseLeave)
    window.removeEventListener('keydown', this.onKeyDown)
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
    if (event.code !== 'Space') return
    event.preventDefault()
    this.followAvatar = true
  }

  /** カーソルが画面端にあるとき、その方向へ視界をスクロールする */
  private updateEdgePan(delta: number): void {
    if (!this.pointer) return
    const { clientWidth, clientHeight } = this.container
    let dx = 0
    let dz = 0
    if (this.pointer.x < EDGE_MARGIN) dx -= 1
    else if (this.pointer.x > clientWidth - EDGE_MARGIN) dx += 1
    if (this.pointer.y < EDGE_MARGIN) dz -= 1
    else if (this.pointer.y > clientHeight - EDGE_MARGIN) dz += 1
    if (dx === 0 && dz === 0) return

    this.followAvatar = false
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
    const rect = this.renderer.domElement.getBoundingClientRect()
    const pointer = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    )
    this.raycaster.setFromCamera(pointer, this.camera)
    const hit = this.raycaster.intersectObject(this.ground, false)[0]
    if (!hit) return

    const path = this.navGrid.findPath(
      { x: this.avatar.position.x, z: this.avatar.position.z },
      { x: hit.point.x, z: hit.point.z },
    )
    if (!path || path.length === 0) return

    this.avatar.setPath(path.map((p) => new THREE.Vector3(p.x, 0, p.z)))
    const dest = path[path.length - 1]
    this.addMarker(new THREE.Vector3(dest.x, 0, dest.z))
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
    this.remotes.update(delta, this.camera.quaternion)
    this.streamer.update(delta, this.scene, this.avatar.position, CAMERA_DIR)
    this.sendPosition(delta)

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
