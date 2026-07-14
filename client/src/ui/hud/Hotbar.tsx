import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine'
import { draggable, dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { getCooldown, subscribeCooldowns } from '../../command/cooldowns'
import { parseCommandLine } from '../../command/parse'
import type { HotbarSlot } from '../../state/hotbar'
import { formatKeybind, type SlotKeybind } from '../../state/keybinds'
import { useAppStore } from '../../state/store'
import { isHotbarSlotData, isPaletteItemData } from './dnd'

interface SlotProps {
  seq: number
  index: number
  slot: HotbarSlot | null
  keybind: SlotKeybind | null
}

/**
 * ホットバーの1スロット。クリックで実行。
 * 中身ありスロットはドラッグ元(スロット間=スワップ(別ホットバーでも可)、スロット外=削除)、
 * 全スロットはパレット/他スロットからのドロップ先。
 */
function HotbarSlotButton({ seq, index, slot, keybind }: SlotProps) {
  const ref = useRef<HTMLButtonElement>(null)
  const overlayRef = useRef<HTMLSpanElement>(null)
  const dispatch = useAppStore((s) => s.dispatch)
  const [over, setOver] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [onCooldown, setOnCooldown] = useState(false)

  // CD開始で再レンダし、以降の進捗はrAFでCSS変数を直接更新する(再レンダ嵐の回避)
  const commandName = slot ? (parseCommandLine(slot.command)?.name ?? null) : null
  const cooldown = useSyncExternalStore(subscribeCooldowns, () =>
    commandName ? getCooldown(commandName) : null,
  )

  useEffect(() => {
    if (!cooldown) return
    setOnCooldown(true)
    let raf = 0
    const tick = () => {
      const remain = cooldown.until - performance.now()
      if (remain <= 0) {
        setOnCooldown(false)
        return
      }
      const angle = (1 - remain / cooldown.durationMs) * 360
      overlayRef.current?.style.setProperty('--cd-angle', `${angle}deg`)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [cooldown])

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
              getInitialData: () => ({ type: 'hotbar-slot', seq, index, slot }),
              onDragStart: () => setDragging(true),
              onDrop: ({ location }) => {
                setDragging(false)
                // どのドロップ先にも落ちなかった=スロットから外す
                if (location.current.dropTargets.length === 0) setHotbarSlot({ seq, index }, null)
              },
            }),
          ]
        : []),
      dropTargetForElements({
        element: el,
        canDrop: ({ source }) =>
          isPaletteItemData(source.data) ||
          (isHotbarSlotData(source.data) &&
            !(source.data.seq === seq && source.data.index === index)),
        onDragEnter: () => setOver(true),
        onDragLeave: () => setOver(false),
        onDrop: ({ source }) => {
          setOver(false)
          if (isPaletteItemData(source.data)) {
            setHotbarSlot({ seq, index }, source.data.slot)
          } else if (isHotbarSlotData(source.data)) {
            swapHotbarSlots({ seq: source.data.seq, index: source.data.index }, { seq, index })
          }
        },
      }),
    )
  }, [slot, seq, index])

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
          : 'コマンドパレット(/palette)からドラッグで割り当て'
      }
      onClick={() => {
        if (slot) void dispatch?.(slot.command)
      }}
    >
      <span className="hud-slot-key">{formatKeybind(keybind)}</span>
      <span className="hud-slot-label">{slot?.label ?? ''}</span>
      {onCooldown && <span className="hud-slot-cooldown" ref={overlayRef} />}
    </button>
  )
}

/** ホットバー1本分。割当はコマンドパレット(/palette)やメニュー(Esc)からドラッグで */
export function Hotbar({ seq }: { seq: number }) {
  const hotbar = useAppStore((s) => s.hotbars.find((h) => h.seq === seq))
  if (!hotbar) return null

  return (
    <div className="hud-hotbar">
      <div className="hud-hotbar-slots">
        {hotbar.slots.map((slot, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: スロットは固定長・並べ替えなし
          <HotbarSlotButton key={i} seq={seq} index={i} slot={slot} keybind={hotbar.keys[i]} />
        ))}
      </div>
    </div>
  )
}
