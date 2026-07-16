import { useAppStore } from '../../state/store'

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
    return editMode ? <div className="hud-target hud-target-empty">対象なし</div> : null
  }
  const hasHp = target.hp !== null && target.hpMax !== null && target.hpMax > 0
  const ratio = hasHp
    ? Math.max(0, Math.min(1, (target.hp as number) / (target.hpMax as number)))
    : 0
  // ゲージ色はワールド空間のbar(SceneRenderer.buildBar)と同じ閾値
  const color = ratio > 0.5 ? '#7cfc8a' : ratio > 0.25 ? '#ffd25e' : '#ff6b5e'
  return (
    <div className={`hud-target${target.alive ? '' : ' hud-target-down'}`}>
      <div className="hud-target-name">
        {target.name}
        {!target.alive && <span className="hud-target-state">(戦闘不能)</span>}
      </div>
      {hasHp && (
        <div className="hud-target-hpbar">
          <div
            className="hud-target-hpfill"
            style={{ width: `${ratio * 100}%`, background: color }}
          />
          <span className="hud-target-hptext">
            {target.hp} / {target.hpMax}
          </span>
        </div>
      )}
    </div>
  )
}
