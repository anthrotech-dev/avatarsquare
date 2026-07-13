import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine'
import { draggable, dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { useEffect, useRef, useState } from 'react'
import type { HotbarSlot } from '../../state/hotbar'
import { formatKeybind } from '../../state/keybinds'
import { useAppStore } from '../../state/store'
import { isHotbarSlotData, isPaletteItemData } from './dnd'

interface SlotProps {
  index: number
  slot: HotbarSlot | null
}

/**
 * ホットバーの1スロット。クリックで実行。
 * 中身ありスロットはドラッグ元(スロット間=スワップ、スロット外=削除)、
 * 全スロットはパレット/他スロットからのドロップ先。
 */
function HotbarSlotButton({ index, slot }: SlotProps) {
  const ref = useRef<HTMLButtonElement>(null)
  const dispatch = useAppStore((s) => s.dispatch)
  const keybind = useAppStore((s) => s.hotbarKeys[index])
  const [over, setOver] = useState(false)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const { setHotbarSlot, swapHotbarSlots } = useAppStore.getState()
    return combine(
      // 空スロットはdraggable登録しない(canDrag(false)は他のドラッグも潰す仕様のため)
      ...(slot
        ? [
            draggable({
              element: el,
              getInitialData: () => ({ type: 'hotbar-slot', index, slot }),
              onDragStart: () => setDragging(true),
              onDrop: ({ location }) => {
                setDragging(false)
                // どのドロップ先にも落ちなかった=スロットから外す
                if (location.current.dropTargets.length === 0) setHotbarSlot(index, null)
              },
            }),
          ]
        : []),
      dropTargetForElements({
        element: el,
        canDrop: ({ source }) =>
          isPaletteItemData(source.data) ||
          (isHotbarSlotData(source.data) && source.data.index !== index),
        onDragEnter: () => setOver(true),
        onDragLeave: () => setOver(false),
        onDrop: ({ source }) => {
          setOver(false)
          if (isPaletteItemData(source.data)) {
            setHotbarSlot(index, source.data.slot)
          } else if (isHotbarSlotData(source.data)) {
            swapHotbarSlots(source.data.index, index)
          }
        },
      }),
    )
  }, [slot, index])

  const classes = ['hud-slot']
  if (!slot) classes.push('empty')
  if (over) classes.push('drag-over')
  if (dragging) classes.push('dragging')

  return (
    <button
      ref={ref}
      type="button"
      className={classes.join(' ')}
      title={
        slot
          ? `${slot.command}(ドラッグで移動 / スロット外へで削除)`
          : 'パレット(+)からドラッグで割り当て'
      }
      onClick={() => {
        if (slot) void dispatch?.(slot.command)
      }}
    >
      <span className="hud-slot-key">{formatKeybind(keybind)}</span>
      <span className="hud-slot-label">{slot?.label ?? ''}</span>
    </button>
  )
}

/** 画面下部中央のホットバー。割当はメニュー(Esc)のコマンドパレットから */
export function Hotbar() {
  const hotbar = useAppStore((s) => s.hotbar)

  return (
    <div className="hud-hotbar">
      <div className="hud-hotbar-slots">
        {hotbar.map((slot, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: スロットは固定長・並べ替えなし
          <HotbarSlotButton key={i} index={i} slot={slot} />
        ))}
      </div>
    </div>
  )
}
