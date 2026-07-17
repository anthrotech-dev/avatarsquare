import { useAppStore } from '../../state/store'
import { BuffList } from './BuffList'

/**
 * ターゲット中の対象に掛かっているバフ・デバフの一覧。値はサーバー同期済みの
 * ノード属性buffsのスナップショット(store.target.buffs)。
 * 未選択・バフなしの間は非表示で、HUD編集モード中だけプレースホルダを出す
 */
export function TargetBuffsPanel() {
  const target = useAppStore((s) => s.target)
  const editMode = useAppStore((s) => s.hudEditMode)
  if (!target || target.buffs.length === 0) {
    return editMode ? <div className="hud-unit hud-unit-empty">対象バフなし</div> : null
  }
  return <BuffList buffs={target.buffs} />
}
