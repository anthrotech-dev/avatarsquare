import { useEffect, useRef, useState } from 'react'
import { clampHudPosition, type HudElementId, type HudPosition } from '../../state/hudLayout'
import { useAppStore } from '../../state/store'
import { type ContextMenuItem, HudContextMenu } from './HudContextMenu'
import { useDragMove } from './useDragMove'

interface Props {
  id: HudElementId
  label: string
  /** CSSデフォルトアンカーのクラス。省略時は hud-anchor-<id> */
  anchorClass?: string
  /** アンカーに渡す追加スタイル(ホットバーの積み上げ位置指定など) */
  anchorStyle?: React.CSSProperties
  /** 編集モードの右クリックメニューに足す要素固有の項目 */
  menuItems?: ContextMenuItem[]
  children: React.ReactNode
}

/**
 * HUD要素の配置ラッパー。カスタム位置(hudLayout)があればそれを、
 * なければCSSのデフォルトアンカー(.hud-anchor-<id>)を使う。
 * HUD編集モード中はオーバーレイで内側の操作を遮断し、ドラッグで移動、
 * 右クリックで設定メニュー(可視切替など)を出せる。
 */
export function HudElement({ id, label, anchorClass, anchorStyle, menuItems, children }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const saved = useAppStore((s) => s.hudLayout[id])
  const visible = useAppStore((s) => s.hudVisibility[id] ?? true)
  const editMode = useAppStore((s) => s.hudEditMode)
  const setHudPosition = useAppStore((s) => s.setHudPosition)
  const setHudVisibility = useAppStore((s) => s.setHudVisibility)
  const [dragPos, setDragPos] = useState<HudPosition | null>(null)
  const [menuPos, setMenuPos] = useState<HudPosition | null>(null)
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
  const style: React.CSSProperties = pos
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
          ...anchorStyle,
          left: clamped.x,
          top: clamped.y,
          right: 'auto',
          bottom: 'auto',
          transform: 'none',
        }
      })()
    : { ...anchorStyle }

  // 非表示要素はプレイモードでは描画せず、編集モード中だけ半透明で見せる(再表示の操作のため)
  if (!visible && !editMode) return null

  const classes = ['hud-anchor', anchorClass ?? `hud-anchor-${id}`]
  if (!visible) classes.push('hud-hidden')

  return (
    <div ref={ref} className={classes.join(' ')} style={style}>
      {children}
      {editMode && (
        <>
          {/* biome-ignore lint/a11y/noStaticElementInteractions: マウス専用のドラッグ/右クリック用オーバーレイ */}
          <div
            className="hud-edit-overlay"
            onPointerDown={drag.onPointerDown}
            onContextMenu={(e) => {
              e.preventDefault()
              setMenuPos({ x: e.clientX, y: e.clientY })
            }}
          />
          {/* 画面上端ではラベルが見切れるため下側に切り替える */}
          <span
            className={
              (ref.current?.getBoundingClientRect().top ?? Infinity) < 34
                ? 'hud-edit-label below'
                : 'hud-edit-label'
            }
          >
            {label}
            {!visible && '(非表示)'}
          </span>
          {menuPos && (
            <HudContextMenu
              pos={menuPos}
              onClose={() => setMenuPos(null)}
              items={[
                ...(menuItems ?? []),
                {
                  label: visible ? '非表示にする' : '表示する',
                  onClick: () => setHudVisibility(id, !visible),
                },
              ]}
            />
          )}
        </>
      )}
    </div>
  )
}
