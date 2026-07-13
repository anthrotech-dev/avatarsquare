export interface ContextMenuItem {
  label: string
  onClick: () => void
}

interface Props {
  pos: { x: number; y: number }
  items: ContextMenuItem[]
  onClose: () => void
}

/**
 * HUD編集モードで要素を右クリックしたときのメニュー。
 * 透明バックドロップで外側クリック(右クリック含む)を拾って閉じる。
 */
export function HudContextMenu({ pos, items, onClose }: Props) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: 外側クリックで閉じるためのスクリム(操作対象ではない)
    <div
      className="hud-context-backdrop"
      onPointerDown={onClose}
      onContextMenu={(e) => {
        e.preventDefault()
        onClose()
      }}
    >
      <div
        className="hud-context-menu"
        style={{ left: pos.x, top: pos.y }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {items.map((item) => (
          <button
            key={item.label}
            type="button"
            onClick={() => {
              onClose()
              item.onClick()
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  )
}
