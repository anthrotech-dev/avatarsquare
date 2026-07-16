import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  clampHudPlacement,
  type HudAnchor,
  type HudElementId,
  type HudPosition,
  placementToStyle,
  placementToTopLeft,
  topLeftToPlacement,
} from '../../state/hudLayout'
import { useAppStore } from '../../state/store'
import { useDragMove } from './useDragMove'

const TOP_LEFT: HudAnchor = { h: 'left', v: 'top' }

/**
 * HUD要素のフローティング配置(保存位置の適用・ドラッグ移動・アンカー切替)。
 * HudElementとHudEditBannerで共有する。
 * 保存が無い要素はstyle=undefinedでCSSデフォルトアンカーに任せ、
 * 初ドラッグ時にrectからデフォルトアンカー基準のオフセットへ変換して保存する。
 */
export function useHudFloat(
  id: HudElementId,
  defaultAnchor: HudAnchor = TOP_LEFT,
): {
  ref: React.RefObject<HTMLDivElement>
  /** 保存位置(またはドラッグ中位置)のinline style。undefined=CSSデフォルトに任せる */
  style: React.CSSProperties | undefined
  /** 現在のアンカー(未保存はデフォルト)。メニューの現在値表示に使う */
  anchor: HudAnchor
  onPointerDown: (e: React.PointerEvent<HTMLElement>) => void
  /** 見た目の位置を変えずにアンカーを切り替えて保存する */
  setAnchor: (anchor: HudAnchor) => void
} {
  const ref = useRef<HTMLDivElement>(null)
  const saved = useAppStore((s) => s.hudLayout[id])
  const setHudPlacement = useAppStore((s) => s.setHudPlacement)
  const [dragPos, setDragPos] = useState<HudPosition | null>(null)
  const [, forceRender] = useState(0)

  // ウィンドウリサイズで描画時クランプをやり直す(保存値は変えない)。
  // right/bottom/calc指定なので再レンダー間の位置追従はブラウザがやってくれる
  useEffect(() => {
    if (!saved) return
    const onResize = () => forceRender((n) => n + 1)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [saved])

  // 初回レンダーはrefが無く要素サイズが取れないため、ref確定後に一度
  // 再レンダーしてright/bottom/center系のクランプを正しく計算する
  // biome-ignore lint/correctness/useExhaustiveDependencies: マウント直後の再測定のみ
  useLayoutEffect(() => {
    if (saved) forceRender((n) => n + 1)
  }, [])

  const viewport = () => ({ width: window.innerWidth, height: window.innerHeight })
  const rectSize = () => {
    const rect = ref.current?.getBoundingClientRect()
    return { width: rect?.width ?? 0, height: rect?.height ?? 0 }
  }

  const anchor = saved?.anchor ?? defaultAnchor

  const drag = useDragMove({
    getInitialPos: () => {
      // デフォルト位置からの初ドラッグはここでpx座標に変換される
      const rect = ref.current?.getBoundingClientRect()
      return saved
        ? placementToTopLeft(saved, rectSize(), viewport())
        : { x: rect?.left ?? 0, y: rect?.top ?? 0 }
    },
    onMove: setDragPos,
    onEnd: (pos) => {
      // ドラッグではアンカーを変えない(変更は右クリックメニューのみ)
      const placement = topLeftToPlacement(pos, anchor, rectSize(), viewport())
      setHudPlacement(id, clampHudPlacement(placement, rectSize(), viewport()))
      setDragPos(null)
    },
  })

  const setAnchor = (newAnchor: HudAnchor) => {
    const rect = ref.current?.getBoundingClientRect()
    if (!rect) return
    // クランプ表示中は「見えている位置」が新アンカーの基準になる(自然な挙動として許容)
    setHudPlacement(
      id,
      topLeftToPlacement({ x: rect.left, y: rect.top }, newAnchor, rectSize(), viewport()),
    )
  }

  let style: React.CSSProperties | undefined
  if (dragPos) {
    // ドラッグ中はクランプせずleft/topでそのまま追従する
    style = { left: dragPos.x, top: dragPos.y, right: 'auto', bottom: 'auto', transform: 'none' }
  } else if (saved) {
    const rect = ref.current?.getBoundingClientRect()
    style = placementToStyle(rect ? clampHudPlacement(saved, rectSize(), viewport()) : saved)
  }

  return { ref, style, anchor, onPointerDown: drag.onPointerDown, setAnchor }
}
