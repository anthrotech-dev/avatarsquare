import { useAppStore } from '../../state/store'
import { BuffList } from './BuffList'

/**
 * 自分に掛かっているバフ・デバフの一覧。値はGameが権威で管理する
 * スナップショット(store.selfBuffs)。バフなしの間は非表示で、
 * HUD編集モード中だけ配置用のプレースホルダを出す
 */
export function SelfBuffsPanel() {
  const buffs = useAppStore((s) => s.selfBuffs)
  const editMode = useAppStore((s) => s.hudEditMode)
  if (buffs.length === 0) {
    return editMode ? <div className="hud-unit hud-unit-empty">バフなし</div> : null
  }
  return <BuffList buffs={buffs} />
}
