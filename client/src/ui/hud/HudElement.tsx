import { useEffect, useRef, useState } from 'react'
import { clampHudPosition, type HudElementId, type HudPosition } from '../../state/hudLayout'
import { useAppStore } from '../../state/store'
import { useDragMove } from './useDragMove'

interface Props {
  id: HudElementId
  label: string
  children: React.ReactNode
}

/**
 * HUD要素の配置ラッパー。カスタム位置(hudLayout)があればそれを、
 * なければCSSのデフォルトアンカー(.hud-anchor-<id>)を使う。
 * HUD編集モード中はオーバーレイで内側の操作を遮断し、ドラッグで移動できる。
 */
export function HudElement({ id, label, children }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const saved = useAppStore((s) => s.hudLayout[id])
  const visible = useAppStore((s) => s.hudVisibility[id])
  const editMode = useAppStore((s) => s.hudEditMode)
  const setHudPosition = useAppStore((s) => s.setHudPosition)
  const setHudVisibility = useAppStore((s) => s.setHudVisibility)
  const setHudDetailOpen = useAppStore((s) => s.setHudDetailOpen)
  const [dragPos, setDragPos] = useState<HudPosition | null>(null)
  const [, forceRender] = useState(0)

  // ウィンドウリサイズで描画時クランプをやり直す(保存値は変えない)
  useEffect(() => {
    if (!saved) return
    const onResize = () => forceRender((n) => n + 1)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [saved])

  const drag = useDragMove({
    getInitialPos: () => {
      // デフォルト位置からの初ドラッグはここでpx座標に変換される
      const rect = ref.current?.getBoundingClientRect()
      return saved ?? { x: rect?.left ?? 0, y: rect?.top ?? 0 }
    },
    onMove: setDragPos,
    onEnd: (pos) => {
      const rect = ref.current?.getBoundingClientRect()
      setHudPosition(
        id,
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
    ? // クランプは描画時に適用(dragPos中はそのまま追従)
      (() => {
        const rect = ref.current?.getBoundingClientRect()
        const clamped = dragPos
          ? pos
          : clampHudPosition(
              pos,
              { width: rect?.width ?? 0, height: rect?.height ?? 0 },
              { width: window.innerWidth, height: window.innerHeight },
            )
        return {
          left: clamped.x,
          top: clamped.y,
          right: 'auto',
          bottom: 'auto',
          transform: 'none',
        }
      })()
    : undefined

  // 非表示要素はプレイモードでは描画せず、編集モード中だけ半透明で見せる(再表示の操作のため)
  if (!visible && !editMode) return null

  const classes = ['hud-anchor', `hud-anchor-${id}`]
  if (!visible) classes.push('hud-hidden')

  return (
    <div ref={ref} className={classes.join(' ')} style={style}>
      {children}
      {editMode && (
        <div className="hud-edit-overlay" onPointerDown={drag.onPointerDown}>
          <span className="hud-edit-label">
            {label}
            {!visible && '(非表示)'}
          </span>
          <div className="hud-edit-buttons">
            {id === 'hotbar' && (
              <button
                type="button"
                className="hud-edit-config"
                title="ホットバー詳細設定"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => setHudDetailOpen('hotbar')}
              >
                ⚙
              </button>
            )}
            <button
              type="button"
              className="hud-edit-config"
              title={visible ? '非表示にする' : '表示する'}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => setHudVisibility(id, !visible)}
            >
              {visible ? '👁' : '−'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
