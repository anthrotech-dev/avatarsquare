export interface ContextMenuItem {
  label: string
  onClick: () => void
}

interface Props {
  pos: { x: number; y: number }
  items: ContextMenuItem[]
  onClose: () => void
  /** ボタンリストの上に出す追加コンテンツ(アンカーピッカーなど) */
  children?: React.ReactNode
}

/**
 * HUD編集モードで要素を右クリックしたときのメニュー。
 * 透明バックドロップで外側クリック(右クリック含む)を拾って閉じる。
 */
export function HudContextMenu({ pos, items, onClose, children }: Props) {
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
        {children}
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
