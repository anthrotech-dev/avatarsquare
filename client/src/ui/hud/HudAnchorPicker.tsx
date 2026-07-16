import type { HudAnchor, HudAnchorH, HudAnchorV } from '../../state/hudLayout'

interface Props {
  value: HudAnchor
  onSelect: (anchor: HudAnchor) => void
}

const ROWS: HudAnchorV[] = ['top', 'middle', 'bottom']
const COLS: HudAnchorH[] = ['left', 'center', 'right']

const LABELS: Record<HudAnchorV, Record<HudAnchorH, string>> = {
  top: { left: '左上', center: '上', right: '右上' },
  middle: { left: '左', center: '中央', right: '右' },
  bottom: { left: '左下', center: '下', right: '右下' },
}

/**
 * HUD編集メニュー内の3×3アンカーピッカー。選んだコーナー/辺を基準に
 * 位置を保存し、ウィンドウリサイズ時も基準からの相対位置を保つ。
 */
export function HudAnchorPicker({ value, onSelect }: Props) {
  return (
    <div className="hud-anchor-picker">
      <div className="hud-anchor-picker-title">アンカー基準</div>
      <div className="hud-anchor-picker-grid">
        {ROWS.flatMap((v) =>
          COLS.map((h) => (
            <button
              key={`${v}-${h}`}
              type="button"
              title={LABELS[v][h]}
              aria-label={LABELS[v][h]}
              className={value.h === h && value.v === v ? 'selected' : undefined}
              onClick={() => onSelect({ h, v })}
            />
          )),
        )}
      </div>
    </div>
  )
}
