import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

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

const VIEWPORT_MARGIN = 8

/**
 * HUD編集モードで要素の歯車ボタンを押したときの設定メニュー。
 * 指定位置が画面外にはみ出す場合はビューポート内にクランプする
 * (画面下端のホットバー等でもメニュー全体が見えるように)。
 * 透明バックドロップで外側クリック(右クリック含む)を拾って閉じる。
 * アンカーにtransformがあるとposition:fixedの基準がずれるため、
 * body直下へポータルで描画する。
 */
export function HudContextMenu({ pos, items, onClose, children }: Props) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [clamped, setClamped] = useState(pos)

  useLayoutEffect(() => {
    const rect = menuRef.current?.getBoundingClientRect()
    if (!rect) return
    setClamped({
      x: Math.max(
        VIEWPORT_MARGIN,
        Math.min(pos.x, window.innerWidth - rect.width - VIEWPORT_MARGIN),
      ),
      y: Math.max(
        VIEWPORT_MARGIN,
        Math.min(pos.y, window.innerHeight - rect.height - VIEWPORT_MARGIN),
      ),
    })
  }, [pos])

  return createPortal(
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
        ref={menuRef}
        className="hud-context-menu"
        style={{ left: clamped.x, top: clamped.y }}
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
    </div>,
    document.body,
  )
}
