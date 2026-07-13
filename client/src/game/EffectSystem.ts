import type * as THREE from 'three'

/**
 * 寿命付きのワールド空間エフェクトを管理する。
 * アクションの見た目はアバター映像キャプチャに乗らないため、
 * ローカル・リモートの双方がこの仕組みで同じエフェクトを生成する。
 * register()で新しい種類を追加できる(プラグイン登録点)。
 *
 * 注意: エフェクトのメッシュはAVATAR_LAYERに登録しないこと
 * (自分の配信キャプチャに映り込んでしまう)。
 */

export interface EffectSpawn {
  kind: string
  x: number
  z: number
  yaw?: number
  /** 対象地点(射撃など) */
  tx?: number
  tz?: number
}

export interface EffectInstance {
  /** 毎フレーム呼ばれる。falseを返すと寿命終了としてdisposeされる */
  update(delta: number): boolean
  dispose(): void
}

export type EffectFactory = (spawn: EffectSpawn, scene: THREE.Scene) => EffectInstance

export class EffectSystem {
  private readonly factories = new Map<string, EffectFactory>()
  private readonly instances: EffectInstance[] = []

  constructor(private readonly scene: THREE.Scene) {}

  register(kind: string, factory: EffectFactory): void {
    this.factories.set(kind, factory)
  }

  /** エフェクトを生成する。未知のkindは無視(前方互換) */
  spawn(spawn: EffectSpawn): void {
    const factory = this.factories.get(spawn.kind)
    if (!factory) return
    this.instances.push(factory(spawn, this.scene))
  }

  update(delta: number): void {
    for (let i = this.instances.length - 1; i >= 0; i--) {
      if (this.instances[i].update(delta)) continue
      this.instances[i].dispose()
      this.instances.splice(i, 1)
    }
  }

  dispose(): void {
    for (const instance of this.instances) instance.dispose()
    this.instances.length = 0
  }
}
