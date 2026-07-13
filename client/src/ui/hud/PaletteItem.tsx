import { draggable } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { useEffect, useRef, useState } from 'react'
import type { HotbarSlot } from '../../state/hotbar'

interface Props {
  slot: HotbarSlot
  /** クリック時にコマンドを実行したい場合に指定(未指定ならドラッグ専用) */
  onActivate?: () => void
  className?: string
}

/**
 * ホットバーのスロットへドラッグ&ドロップで登録できるコマンド1項目。
 * コマンドパレットとメニュー(Esc)で共用する。
 */
export function PaletteItem({ slot, onActivate, className = 'hud-palette-item' }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    return draggable({
      element: el,
      getInitialData: () => ({ type: 'palette-item', slot }),
      onDragStart: () => setDragging(true),
      onDrop: () => setDragging(false),
    })
  }, [slot])

  return (
    <div
      ref={ref}
      className={dragging ? `${className} dragging` : className}
      title={`${slot.command}(スロットへドラッグで登録)`}
      {...(onActivate && {
        role: 'button',
        tabIndex: 0,
        onClick: onActivate,
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') onActivate()
        },
      })}
    >
      {slot.label}
    </div>
  )
}
