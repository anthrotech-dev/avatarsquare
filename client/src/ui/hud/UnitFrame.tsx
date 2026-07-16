interface UnitFrameProps {
  name: string
  /** 名前の横の補足表示(「(戦闘不能)」など) */
  state?: string
  /** hp/hpMaxが両方有効な時だけゲージを表示する */
  hp: number | null
  hpMax: number | null
  /** 戦闘不能などのグレーアウト */
  down?: boolean
}

/** ゲージ色はワールド空間のbar(SceneRenderer.buildBar)と同じ閾値 */
function hpColor(ratio: number): string {
  return ratio > 0.5 ? '#7cfc8a' : ratio > 0.25 ? '#ffd25e' : '#ff6b5e'
}

/**
 * 名前+HPゲージのユニットフレーム。自分(StatusPanel)とターゲット
 * (TargetPanel)で見た目を共有するための表示専用コンポーネント。
 */
export function UnitFrame({ name, state, hp, hpMax, down }: UnitFrameProps) {
  const hasHp = hp !== null && hpMax !== null && hpMax > 0
  const ratio = hasHp ? Math.max(0, Math.min(1, hp / hpMax)) : 0
  return (
    <div className={`hud-unit${down ? ' hud-unit-down' : ''}`}>
      <div className="hud-unit-name">
        {name}
        {state && <span className="hud-unit-state">{state}</span>}
      </div>
      {hasHp && (
        <div className="hud-unit-hpbar">
          <div
            className="hud-unit-hpfill"
            style={{ width: `${ratio * 100}%`, background: hpColor(ratio) }}
          />
          <span className="hud-unit-hptext">
            {hp} / {hpMax}
          </span>
        </div>
      )}
    </div>
  )
}
