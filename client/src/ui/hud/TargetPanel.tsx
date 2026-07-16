import { useAppStore } from '../../state/store'
import { UnitFrame } from './UnitFrame'

/**
 * 選択中ターゲットのパネル(上部中央)。対象の名前と、対象がhp/hpMaxの
 * 公開パラメータを持つ場合はHPゲージ+数値を表示する。
 * 値はサーバー同期済みのノード属性のスナップショット(Gameがstoreへ流す)。
 */
export function TargetPanel() {
  const target = useAppStore((s) => s.target)
  const editMode = useAppStore((s) => s.hudEditMode)
  // 未選択時は非表示。HUD編集モード中だけ配置用のプレースホルダを出す
  if (!target) {
    return editMode ? <div className="hud-unit hud-unit-empty">対象なし</div> : null
  }
  return (
    <UnitFrame
      name={target.name}
      state={target.alive ? undefined : '(戦闘不能)'}
      hp={target.hp}
      hpMax={target.hpMax}
      down={!target.alive}
    />
  )
}
