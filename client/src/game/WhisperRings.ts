import * as THREE from 'three'
import { acquireFlatMaterial, releaseFlatMaterial } from './materialPool'

/**
 * ウィスパーの可聴範囲円。話者(自分・リモート)ごとに地面へリングを描き、
 * 毎フレームアバター位置に追従させる。円は全員に見える(vmodeメッセージを
 * 受けた各クライアントが自前で描く)ため、AVATAR_LAYERには入れない
 * (自分の配信キャプチャに映さない)。
 */

/** 半径1のリング(scaleで実半径に拡大)。共有ジオメトリなのでdisposeしない */
const RING_GEOMETRY = new THREE.RingGeometry(0.96, 1.0, 64)
const RING_COLOR = 0x9f7cfc
const RING_OPACITY = 0.55
/** Zファイティング回避の地面オフセット */
const RING_Y = 0.04

export class WhisperRings {
  private readonly rings = new Map<string, THREE.Mesh>()

  constructor(private readonly scene: THREE.Scene) {}

  /** 話者の円を出す(半径m)/消す(null)。半径変更は同idで呼び直す */
  set(id: string, radius: number | null): void {
    const existing = this.rings.get(id)
    if (radius === null) {
      if (existing) this.remove(id, existing)
      return
    }
    if (existing) {
      existing.scale.setScalar(radius)
      return
    }
    const mesh = new THREE.Mesh(RING_GEOMETRY, acquireFlatMaterial(RING_COLOR))
    ;(mesh.material as THREE.MeshBasicMaterial).opacity = RING_OPACITY
    mesh.rotation.x = -Math.PI / 2
    mesh.scale.setScalar(radius)
    mesh.position.y = RING_Y
    this.scene.add(mesh)
    this.rings.set(id, mesh)
  }

  /** 毎フレーム: 各円を話者の表示位置に追従させる。いない話者の円は消す */
  update(
    selfId: string,
    selfPos: THREE.Vector3,
    remotePositions: Iterable<[string, THREE.Vector3]>,
  ): void {
    const seen = new Set<string>([selfId])
    const self = this.rings.get(selfId)
    if (self) self.position.set(selfPos.x, RING_Y, selfPos.z)
    for (const [id, pos] of remotePositions) {
      seen.add(id)
      const ring = this.rings.get(id)
      if (ring) ring.position.set(pos.x, RING_Y, pos.z)
    }
    // アバター未生成・退室済みの話者の円は出しっぱなしにしない
    for (const [id, ring] of this.rings) {
      if (!seen.has(id)) this.remove(id, ring)
    }
  }

  clear(): void {
    for (const [id, ring] of this.rings) this.remove(id, ring)
  }

  private remove(id: string, ring: THREE.Mesh): void {
    this.scene.remove(ring)
    releaseFlatMaterial(ring.material as THREE.MeshBasicMaterial)
    this.rings.delete(id)
  }
}
