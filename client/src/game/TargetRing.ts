import * as THREE from 'three'
import { acquireFlatMaterial, releaseFlatMaterial } from './materialPool'

/**
 * 選択中ターゲットの足元リング。カーソル自動選択もあるため
 * 「今どのエンティティを選択しているか」の視覚フィードバックを担う。
 * 移動マーカーと同色(=クリック系フィードバックの既存言語)で、
 * WhisperRingsと同じフラットマテリアルのプールを使う。
 */

/** 半径1のリング(scaleで実半径に拡大)。共有ジオメトリなのでdisposeしない */
const RING_GEOMETRY = new THREE.RingGeometry(0.82, 1.0, 48)
const RING_COLOR = 0xffe066
const RING_OPACITY = 0.85
/** Zファイティング回避の地面オフセット */
const RING_Y = 0.05
/** 的の半径に対するリングの倍率(足元より少し外に出す) */
const RADIUS_SCALE = 1.3

export class TargetRing {
  private mesh: THREE.Mesh | null = null

  constructor(private readonly scene: THREE.Scene) {}

  /** 対象の足元に出す(radiusは的の半径m)。nullで消す */
  set(target: { x: number; z: number; radius: number } | null): void {
    if (!target) {
      this.clear()
      return
    }
    if (!this.mesh) {
      this.mesh = new THREE.Mesh(RING_GEOMETRY, acquireFlatMaterial(RING_COLOR))
      ;(this.mesh.material as THREE.MeshBasicMaterial).opacity = RING_OPACITY
      this.mesh.rotation.x = -Math.PI / 2
      this.scene.add(this.mesh)
    }
    this.mesh.position.set(target.x, RING_Y, target.z)
    this.mesh.scale.setScalar(Math.max(target.radius, 0.3) * RADIUS_SCALE)
  }

  clear(): void {
    if (!this.mesh) return
    this.scene.remove(this.mesh)
    releaseFlatMaterial(this.mesh.material as THREE.MeshBasicMaterial)
    this.mesh = null
  }
}
