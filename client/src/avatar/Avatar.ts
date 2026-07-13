import type { VRM } from '@pixiv/three-vrm'
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { AnimationController } from './AnimationController'
import {
  type AnimationFileKind,
  loadAnimationClip,
  looksLikeAnimationFile,
} from './animationLoaders'
import { buildIdleClip, buildWalkClip } from './builtinClips'

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
  private path: THREE.Vector3[] = []
  private pathIndex = 0
  private moving = false
  private walkPhase = 0

  constructor(scene: THREE.Scene) {
    this.placeholder = buildPlaceholder()
    this.root.add(this.placeholder)
    this.root.add(buildBlobShadow())
    scene.add(this.root)
  }

  get position(): THREE.Vector3 {
    return this.root.position
  }

  get isMoving(): boolean {
    return this.moving
  }

  get hasVRM(): boolean {
    return this.vrm !== null
  }

  setPath(points: THREE.Vector3[]): void {
    this.path = points
    this.pathIndex = 0
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

  update(delta: number): void {
    this.updateMovement(delta)
    if (this.animation) {
      this.animation.setLocomotion(this.moving ? 'walk' : 'idle')
      this.animation.update(delta)
    }
    if (this.placeholder.visible) this.updatePlaceholderMotion(delta)
    this.vrm?.update(delta)
  }

  /** public/animations/ に置かれたデフォルト素材(walk/idle)を試しに読む */
  private async loadDefaultAnimations(): Promise<void> {
    const vrm = this.vrm
    const animation = this.animation
    if (!vrm || !animation) return
    for (const name of ['idle', 'walk'] as const) {
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
