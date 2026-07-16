import { useEffect, useRef, useState } from 'react'
import { clampHudPosition, type HudPosition } from '../../state/hudLayout'
import { useAppStore } from '../../state/store'
import { useDragMove } from './useDragMove'

/**
 * HUD編集モード中に出る操作バナー。Escapeでも終了できる。
 * HudElementでラップすると編集オーバーレイがボタンを塞ぐため、
 * バナー自身がドラッグ移動を持つ(配置ロジックはHudElementと同型。
 * 位置はhudLayoutに'edit-banner'として永続化し、配置リセットで一緒に戻る)。
 */
export function HudEditBanner() {
  const ref = useRef<HTMLDivElement>(null)
  const setHudEditMode = useAppStore((s) => s.setHudEditMode)
  const resetHudLayout = useAppStore((s) => s.resetHudLayout)
  const addHotbar = useAppStore((s) => s.addHotbar)
  const saved = useAppStore((s) => s.hudLayout['edit-banner'])
  const setHudPosition = useAppStore((s) => s.setHudPosition)
  const [dragPos, setDragPos] = useState<HudPosition | null>(null)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setHudEditMode(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [setHudEditMode])

  const drag = useDragMove({
    getInitialPos: () => {
      const rect = ref.current?.getBoundingClientRect()
      return saved ?? { x: rect?.left ?? 0, y: rect?.top ?? 0 }
    },
    onMove: setDragPos,
    onEnd: (pos) => {
      const rect = ref.current?.getBoundingClientRect()
      setHudPosition(
        'edit-banner',
        clampHudPosition(
          pos,
          { width: rect?.width ?? 0, height: rect?.height ?? 0 },
          { width: window.innerWidth, height: window.innerHeight },
        ),
      )
      setDragPos(null)
    },
  })

  const pos = dragPos ?? saved
  const style: React.CSSProperties | undefined = pos
    ? { left: pos.x, top: pos.y, transform: 'none' }
    : undefined

  return (
    <div
      ref={ref}
      className="hud-edit-banner"
      style={style}
      onPointerDown={(e) => {
        if ((e.target as Element).closest('button')) return
        drag.onPointerDown(e)
      }}
    >
      <span>HUD編集中 — ドラッグで移動 / 右クリックで設定</span>
      <button type="button" onClick={addHotbar}>
        ホットバーを追加
      </button>
      <button type="button" onClick={resetHudLayout}>
        配置をリセット
      </button>
      <button type="button" onClick={() => setHudEditMode(false)}>
        完了 (Esc)
      </button>
    </div>
  )
}
