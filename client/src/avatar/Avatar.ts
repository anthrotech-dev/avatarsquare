import type { VRM } from '@pixiv/three-vrm'
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { Nameplate } from '../game/nameplate'
import { BUBBLE_WORLD_H, SpeechBubble } from '../game/speechBubble'
import type { PeerVoiceState } from '../net/VoiceChat'
import { AnimationController } from './AnimationController'
import {
  type AnimationFileKind,
  loadAnimationClip,
  looksLikeAnimationFile,
} from './animationLoaders'
import { buildActionClips, buildIdleClip, buildWalkClip } from './builtinClips'
import { AVATAR_LAYER } from './captureSpec'
import { isAirborne, JUMP_SPEED, stepVertical } from './verticalMotion'

export const WALK_SPEED = 3.2 // m/s
const TURN_SPEED = 12 // 大きいほど旋回が速い
const ARRIVE_THRESHOLD = 0.08

/**
 * ローカル操作するアバター。VRM未読み込みの間はプレースホルダーを表示する。
 * A*で得た中継地点列に沿って移動する。マップは平坦なのでyは常に0。
 */
export class Avatar {
  readonly root = new THREE.Group()

  private vrm: VRM | null = null
  private animation: AnimationController | null = null
  private placeholder: THREE.Group
  private readonly shadow: THREE.Mesh
  private nameplate: Nameplate | null = null
  private bubble: SpeechBubble | null = null
  private path: THREE.Vector3[] = []
  private pathIndex = 0
  private moving = false
  private walkPhase = 0
  private vy = 0
  /** 口パクの開き具合(0〜1)。VoiceChatが毎フレーム更新する */
  private mouthOpen = 0
  // ネームプレートは名前が付くまで生成されないため、VC状態は別途保持して生成時に適用する
  private voiceState: PeerVoiceState = 'off'
  private speaking = false

  constructor(scene: THREE.Scene) {
    this.placeholder = buildPlaceholder()
    // アバター本体は配信キャプチャ用レイヤーにも登録する(ブロブシャドウは除く)
    this.placeholder.traverse((obj) => obj.layers.enable(AVATAR_LAYER))
    this.root.add(this.placeholder)
    this.shadow = buildBlobShadow()
    this.root.add(this.shadow)
    scene.add(this.root)
  }

  get position(): THREE.Vector3 {
    return this.root.position
  }

  get isMoving(): boolean {
    return this.moving
  }

  get yaw(): number {
    return this.root.rotation.y
  }

  get hasVRM(): boolean {
    return this.vrm !== null
  }

  setPath(points: THREE.Vector3[]): void {
    this.path = points
    this.pathIndex = 0
  }

  /**
   * 頭上のネームプレートを設定する。空文字で非表示。
   * AVATAR_LAYERには載せない=自分の配信映像には映り込まない
   * (相手側では相手のクライアントが描画する)。rootの子なのでジャンプに追従する。
   */
  setNameplate(text: string): void {
    if (!this.nameplate) {
      if (!text) return
      this.nameplate = new Nameplate(text)
      this.nameplate.sprite.position.y = 2.0
      this.nameplate.setVoiceState(this.voiceState)
      this.nameplate.setSpeaking(this.speaking)
      this.root.add(this.nameplate.sprite)
      return
    }
    this.nameplate.setText(text)
  }

  /** 自分のVC状態(ネームプレートのアイコン表示) */
  setVoiceState(state: PeerVoiceState): void {
    this.voiceState = state
    this.nameplate?.setVoiceState(state)
  }

  /** 自分の発話中表示(ネームプレートの色) */
  setSpeaking(speaking: boolean): void {
    this.speaking = speaking
    this.nameplate?.setSpeaking(speaking)
  }

  /**
   * 口パクの開き具合を設定する。update()でVRM表情'aa'に反映され、
   * 配信キャプチャにも乗るためリモート側の追加処理は不要。
   */
  setMouthOpen(weight: number): void {
    this.mouthOpen = weight
  }

  /**
   * チャット発言を頭上の吹き出しに表示する。ネームプレート同様
   * AVATAR_LAYERには載せない=自分の配信映像には映り込まない。
   * 吹き出しは下端基準で上に伸びるため、中心はネームプレートの上に置く。
   */
  say(text: string): void {
    if (!this.bubble) {
      this.bubble = new SpeechBubble()
      this.bubble.sprite.position.y = 2.25 + BUBBLE_WORLD_H / 2
      this.root.add(this.bubble.sprite)
    }
    this.bubble.show(text)
  }

  /** ジャンプを開始する。空中なら失敗。移動パスは中断しない */
  jump(): boolean {
    if (isAirborne({ y: this.root.position.y, vy: this.vy })) return false
    this.vy = JUMP_SPEED
    if (this.animation?.has('jump')) this.animation.playOnce('jump')
    return true
  }

  /** 指定地点の方向へ即座に向く(対象を取るアクション用) */
  faceTowards(x: number, z: number): void {
    const dx = x - this.root.position.x
    const dz = z - this.root.position.z
    if (dx === 0 && dz === 0) return
    this.root.rotation.y = Math.atan2(dx, dz)
  }

  /**
   * アクション用クリップを1回再生する。
   * VRM未読込・クリップ未登録でもthrowしない(エフェクトだけでも成立させる)。
   */
  playActionClip(name: string): void {
    if (this.animation?.has(name)) this.animation.playOnce(name)
  }

  async loadVRM(data: ArrayBuffer): Promise<string> {
    const loader = new GLTFLoader()
    loader.register((parser) => new VRMLoaderPlugin(parser))
    const gltf = await loader.parseAsync(data, '')
    const vrm = gltf.userData.vrm as VRM | undefined
    if (!vrm) throw new Error('VRMデータが含まれていません')

    VRMUtils.removeUnnecessaryVertices(gltf.scene)
    VRMUtils.combineSkeletons(gltf.scene)
    VRMUtils.rotateVRM0(vrm)

    vrm.scene.traverse((obj) => {
      // スキンメッシュはバウンディングが追従しないためカリングを無効化
      obj.frustumCulled = false
      obj.layers.enable(AVATAR_LAYER)
    })

    if (this.vrm) {
      this.animation?.dispose()
      this.root.remove(this.vrm.scene)
      VRMUtils.deepDispose(this.vrm.scene)
    }
    this.vrm = vrm
    this.placeholder.visible = false
    this.root.add(vrm.scene)

    // 組み込みクリップを登録し、外部素材があれば差し替える
    this.animation = new AnimationController(vrm)
    this.animation.register('idle', buildIdleClip(vrm))
    this.animation.register('walk', buildWalkClip(vrm))
    for (const [name, clip] of buildActionClips(vrm)) this.animation.register(name, clip)
    this.animation.setLocomotion('idle')
    void this.loadDefaultAnimations()

    const meta = vrm.meta as { name?: string; title?: string }
    return meta.name ?? meta.title ?? 'VRM'
  }

  /**
   * アニメーション素材(.vrma / Mixamo系.fbx)を登録する。
   * walk/idle以外の名前はエモート・攻撃などとして即時1回再生する。
   */
  async loadAnimation(name: string, data: ArrayBuffer, kind: AnimationFileKind): Promise<void> {
    if (!this.vrm || !this.animation) throw new Error('先にVRMを読み込んでください')
    const clip = await loadAnimationClip(data, kind, this.vrm)
    this.animation.register(name, clip)
    if (name !== 'walk' && name !== 'idle') this.animation.playOnce(name)
  }

  /** URLのVRMAをエモートとして再生する。初回のみ取得し、以後はキャッシュされたクリップを使う */
  async playEmote(name: string, url: string): Promise<void> {
    if (!this.vrm || !this.animation) throw new Error('先にVRMを読み込んでください')
    if (!this.animation.has(name)) {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`${url} の取得に失敗しました (${res.status})`)
      const data = await res.arrayBuffer()
      if (!looksLikeAnimationFile(data, 'vrma')) throw new Error('VRMAファイルではありません')
      this.animation.register(name, await loadAnimationClip(data, 'vrma', this.vrm))
    }
    this.animation.playOnce(name)
  }

  update(delta: number): void {
    this.updateMovement(delta)
    this.updateVertical(delta)
    if (this.animation) {
      this.animation.setLocomotion(this.moving ? 'walk' : 'idle')
      this.animation.update(delta)
    }
    if (this.placeholder.visible) this.updatePlaceholderMotion(delta)
    this.bubble?.update(delta)
    // ミキサー適用後・vrm.update前に上書きすることで、VRMAが表情トラックを
    // 持っていても口パクが勝つ。expressionManager非搭載のVRMではno-op
    this.vrm?.expressionManager?.setValue('aa', this.mouthOpen)
    this.vrm?.update(delta)
  }

  /** ジャンプの鉛直運動。シャドウはrootの子なので、逆オフセットで地面に残す */
  private updateVertical(delta: number): void {
    const step = stepVertical({ y: this.root.position.y, vy: this.vy }, delta)
    this.root.position.y = step.y
    this.vy = step.vy
    this.shadow.position.y = 0.03 - step.y
    const shrink = Math.max(0.55, 1 - step.y * 0.3)
    this.shadow.scale.set(shrink, 0.7 * shrink, shrink)
  }

  /** public/animations/ に置かれたデフォルト素材を試しに読む */
  private async loadDefaultAnimations(): Promise<void> {
    const vrm = this.vrm
    const animation = this.animation
    if (!vrm || !animation) return
    for (const name of ['idle', 'walk', 'jump', 'slash', 'shoot'] as const) {
      for (const kind of ['vrma', 'fbx'] as const) {
        try {
          const res = await fetch(`/animations/${name}.${kind}`)
          if (!res.ok) continue
          const data = await res.arrayBuffer()
          if (!looksLikeAnimationFile(data, kind)) continue
          animation.register(name, await loadAnimationClip(data, kind, vrm))
          break
        } catch {
          // 無ければ組み込みクリップのまま
        }
      }
    }
  }

  private updateMovement(delta: number): void {
    this.moving = false
    let remaining = WALK_SPEED * delta

    while (remaining > 0 && this.pathIndex < this.path.length) {
      const target = this.path[this.pathIndex]
      const dir = new THREE.Vector3(
        target.x - this.root.position.x,
        0,
        target.z - this.root.position.z,
      )
      const dist = dir.length()
      if (dist < ARRIVE_THRESHOLD) {
        this.pathIndex++
        continue
      }

      this.moving = true
      dir.normalize()

      // モデルは +Z 向きが正面
      const targetYaw = Math.atan2(dir.x, dir.z)
      let deltaYaw = targetYaw - this.root.rotation.y
      deltaYaw = THREE.MathUtils.euclideanModulo(deltaYaw + Math.PI, Math.PI * 2) - Math.PI
      this.root.rotation.y += deltaYaw * Math.min(1, TURN_SPEED * delta)

      const step = Math.min(remaining, dist)
      this.root.position.addScaledVector(dir, step)
      remaining -= step
    }

    if (this.pathIndex >= this.path.length) this.path = []
  }

  /** プレースホルダー用の簡易歩行モーション(上下動と揺れ) */
  private updatePlaceholderMotion(delta: number): void {
    if (this.moving) {
      this.walkPhase += delta * 10
      this.placeholder.position.y = Math.abs(Math.sin(this.walkPhase)) * 0.08
      this.placeholder.rotation.z = Math.sin(this.walkPhase) * 0.06
    } else {
      this.placeholder.position.y *= 0.85
      this.placeholder.rotation.z *= 0.85
    }
  }
}

function buildPlaceholder(): THREE.Group {
  const group = new THREE.Group()
  const mat = new THREE.MeshStandardMaterial({ color: 0x4fb3bf, roughness: 0.7 })

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.8, 4, 12), mat)
  body.position.y = 0.85

  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.25, 8), mat)
  nose.rotation.x = Math.PI / 2
  nose.position.set(0, 1.3, 0.32)

  group.add(body, nose)
  return group
}

function buildBlobShadow(): THREE.Mesh {
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.42, 24),
    new THREE.MeshBasicMaterial({ color: 0x1e321e, transparent: true, opacity: 0.35 }),
  )
  shadow.rotation.x = -Math.PI / 2
  shadow.scale.y = 0.7
  shadow.position.y = 0.03
  return shadow
}
