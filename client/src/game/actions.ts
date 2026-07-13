/**
 * アバターアクションの定義。アニメーションクリップとワールドエフェクトの
 * 組み合わせを宣言し、Game.performActionが解釈・実行・送信する。
 * Game.registerActionで追加できる(プラグイン登録点)。
 */
export interface ActionDef {
  name: string
  /** AnimationControllerでplayOnceするクリップ名(未登録ならスキップ) */
  clip?: string
  /** EffectSystemで生成するエフェクトのkind */
  effect?: string
  /** 実行時に移動を中断するか */
  stopsMovement: boolean
  /** 対象地点(tx,tz)を取るか */
  needsTarget: boolean
}

// ジャンプは鉛直運動がposメッセージのyで同期されるため、ここには含めない
// (Avatar.jumpが直接担当する)
export const BUILTIN_ACTIONS: ActionDef[] = [
  { name: 'slash', clip: 'slash', effect: 'slash', stopsMovement: true, needsTarget: false },
  { name: 'shoot', clip: 'shoot', effect: 'shot', stopsMovement: true, needsTarget: true },
]
