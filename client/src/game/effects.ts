import * as THREE from 'three'
import type { EffectInstance, EffectSpawn, EffectSystem } from './EffectSystem'
import { acquireFlatMaterial, releaseFlatMaterial } from './materialPool'

/**
 * 組み込みエフェクト。クリックマーカーと同じく
 * MeshBasicMaterial + transparent + depthWrite:false の軽量描画で統一する。
 * マテリアルはプール経由で使い回す(disposeするとシェーダー再コンパイルが起きる)。
 */

const SLASH_LIFETIME = 0.28
const SLASH_ARC = (100 * Math.PI) / 180
const SHOT_SPEED = 14 // m/s
const SHOT_HEIGHT = 1.0
const IMPACT_LIFETIME = 0.3

/** yaw方向を中心にした扇形が展開してフェードする斬撃 */
class SlashEffect implements EffectInstance {
  private readonly mesh: THREE.Mesh
  private age = 0

  constructor(
    spawn: EffectSpawn,
    private readonly scene: THREE.Scene,
  ) {
    const yaw = spawn.yaw ?? 0
    // 地面に寝かせたリングでは、ローカル角θの点がワールド(cosθ, 0, -sinθ)に
    // 対応するため、前方(sin yaw, 0, cos yaw)の中心角は yaw - π/2
    const geometry = new THREE.RingGeometry(
      0.5,
      1.4,
      24,
      1,
      yaw - Math.PI / 2 - SLASH_ARC / 2,
      SLASH_ARC,
    )
    this.mesh = new THREE.Mesh(geometry, acquireFlatMaterial(0xd9ecff))
    this.mesh.rotation.x = -Math.PI / 2
    this.mesh.position.set(spawn.x, 0.06, spawn.z)
    scene.add(this.mesh)
  }

  update(delta: number): boolean {
    this.age += delta
    const t = this.age / SLASH_LIFETIME
    if (t >= 1) return false
    this.mesh.scale.setScalar(0.6 + t * 0.9)
    ;(this.mesh.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - t)
    return true
  }

  dispose(): void {
    this.scene.remove(this.mesh)
    this.mesh.geometry.dispose()
    releaseFlatMaterial(this.mesh.material as THREE.MeshBasicMaterial)
  }
}

/** 発光弾が対象地点まで飛び、着弾でリングが展開する射撃 */
class ShotEffect implements EffectInstance {
  private readonly bullet: THREE.Mesh
  private ring: THREE.Mesh | null = null
  private readonly target: THREE.Vector3
  private impactAge = 0

  constructor(
    spawn: EffectSpawn,
    private readonly scene: THREE.Scene,
  ) {
    this.bullet = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 12, 8),
      acquireFlatMaterial(0xffc766),
    )
    this.bullet.position.set(spawn.x, SHOT_HEIGHT, spawn.z)
    this.target = new THREE.Vector3(spawn.tx ?? spawn.x, SHOT_HEIGHT, spawn.tz ?? spawn.z)
    scene.add(this.bullet)
  }

  update(delta: number): boolean {
    if (!this.ring) {
      const toTarget = this.target.clone().sub(this.bullet.position)
      const step = SHOT_SPEED * delta
      if (toTarget.length() <= step) {
        this.spawnImpactRing()
        return true
      }
      this.bullet.position.addScaledVector(toTarget.normalize(), step)
      return true
    }

    this.impactAge += delta
    const t = this.impactAge / IMPACT_LIFETIME
    if (t >= 1) return false
    this.ring.scale.setScalar(0.4 + t * 1.6)
    ;(this.ring.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - t)
    return true
  }

  private spawnImpactRing(): void {
    this.bullet.visible = false
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.28, 0.42, 24),
      acquireFlatMaterial(0xffc766),
    )
    this.ring.rotation.x = -Math.PI / 2
    this.ring.position.set(this.target.x, 0.06, this.target.z)
    this.scene.add(this.ring)
  }

  dispose(): void {
    this.scene.remove(this.bullet)
    this.bullet.geometry.dispose()
    releaseFlatMaterial(this.bullet.material as THREE.MeshBasicMaterial)
    if (this.ring) {
      this.scene.remove(this.ring)
      this.ring.geometry.dispose()
      releaseFlatMaterial(this.ring.material as THREE.MeshBasicMaterial)
    }
  }
}

const HITFLASH_LIFETIME = 0.35

/** 被弾地点で赤いリングが弾ける(サーバーのgevent hit由来の演出) */
class HitFlashEffect implements EffectInstance {
  private readonly mesh: THREE.Mesh
  private age = 0

  constructor(
    spawn: EffectSpawn,
    private readonly scene: THREE.Scene,
  ) {
    this.mesh = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.5, 24), acquireFlatMaterial(0xff5e4a))
    this.mesh.rotation.x = -Math.PI / 2
    this.mesh.position.set(spawn.x, 0.08, spawn.z)
    scene.add(this.mesh)
  }

  update(delta: number): boolean {
    this.age += delta
    const t = this.age / HITFLASH_LIFETIME
    if (t >= 1) return false
    this.mesh.scale.setScalar(0.5 + t * 1.8)
    ;(this.mesh.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - t)
    return true
  }

  dispose(): void {
    this.scene.remove(this.mesh)
    this.mesh.geometry.dispose()
    releaseFlatMaterial(this.mesh.material as THREE.MeshBasicMaterial)
  }
}

export function registerBuiltinEffects(system: EffectSystem): void {
  system.register('slash', (spawn, scene) => new SlashEffect(spawn, scene))
  system.register('shot', (spawn, scene) => new ShotEffect(spawn, scene))
  system.register('hitflash', (spawn, scene) => new HitFlashEffect(spawn, scene))
}
