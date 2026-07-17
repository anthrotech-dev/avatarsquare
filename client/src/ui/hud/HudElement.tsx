import { useState } from 'react'
import type { HudAnchor, HudElementId, HudPosition } from '../../state/hudLayout'
import { useAppStore } from '../../state/store'
import { HudAnchorPicker } from './HudAnchorPicker'
import { type ContextMenuItem, HudContextMenu } from './HudContextMenu'
import { useHudFloat } from './useHudFloat'

interface Props {
  id: HudElementId
  label: string
  /** CSSデフォルトアンカーのクラス。省略時は hud-anchor-<id> */
  anchorClass?: string
  /** アンカーに渡す追加スタイル(ホットバーの積み上げ位置指定など) */
  anchorStyle?: React.CSSProperties
  /** アンカー基準の初期値。CSSデフォルト位置に合わせる(省略時は左上) */
  defaultAnchor?: HudAnchor
  /** 編集モードの設定メニューに足す要素固有の項目 */
  menuItems?: ContextMenuItem[]
  children: React.ReactNode
}

/**
 * HUD要素の配置ラッパー。カスタム配置(hudLayout)があればそれを、
 * なければCSSのデフォルトアンカー(.hud-anchor-<id>)を使う。
 * HUD編集モード中はオーバーレイで内側の操作を遮断し、ドラッグで移動、
 * ラベル横の歯車ボタンで設定メニュー(アンカー基準・可視切替など)を出せる。
 */
export function HudElement({
  id,
  label,
  anchorClass,
  anchorStyle,
  defaultAnchor,
  menuItems,
  children,
}: Props) {
  const visible = useAppStore((s) => s.hudVisibility[id] ?? true)
  const editMode = useAppStore((s) => s.hudEditMode)
  const setHudVisibility = useAppStore((s) => s.setHudVisibility)
  const [menuPos, setMenuPos] = useState<HudPosition | null>(null)
  const float = useHudFloat(id, defaultAnchor)

  // 非表示要素はプレイモードでは描画せず、編集モード中だけ半透明で見せる(再表示の操作のため)
  if (!visible && !editMode) return null

  const classes = ['hud-anchor', anchorClass ?? `hud-anchor-${id}`]
  if (!visible) classes.push('hud-hidden')

  return (
    <div
      ref={float.ref}
      className={classes.join(' ')}
      style={float.style ? { ...anchorStyle, ...float.style } : { ...anchorStyle }}
    >
      {children}
      {editMode && (
        <>
          <div className="hud-edit-overlay" onPointerDown={float.onPointerDown} />
          {/* 画面上端ではラベルが見切れるため下側に切り替える */}
          <span
            className={
              (float.ref.current?.getBoundingClientRect().top ?? Infinity) < 34
                ? 'hud-edit-label below'
                : 'hud-edit-label'
            }
          >
            {label}
            {!visible && '(非表示)'}
            <button
              type="button"
              className="hud-edit-gear"
              title="設定"
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect()
                setMenuPos({ x: rect.left, y: rect.bottom + 4 })
              }}
            >
              ⚙
            </button>
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
            >
              <HudAnchorPicker
                value={float.anchor}
                onSelect={(anchor) => {
                  setMenuPos(null)
                  float.setAnchor(anchor)
                }}
              />
            </HudContextMenu>
          )}
        </>
      )}
    </div>
  )
}
