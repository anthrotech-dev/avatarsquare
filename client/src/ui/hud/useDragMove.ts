import { useCallback, useRef } from 'react'
import type { HudPosition } from '../../state/hudLayout'

export interface DragMoveOptions {
  /** ドラッグ開始時点の要素位置(通常はgetBoundingClientRectのleft/top) */
  getInitialPos: () => HudPosition
  /** 毎pointermove。呼び出し側がlocal stateに反映する */
  onMove: (pos: HudPosition) => void
  /** pointerup時。呼び出し側がクランプ+保存する */
  onEnd: (pos: HudPosition) => void
}

/**
 * pointer eventsによるドラッグ移動。ハンドル要素のonPointerDownに繋ぐ。
 * setPointerCaptureするため、canvas上を横切ってもゲーム側のリスナーには流れない。
 * ハンドル要素にはCSSで user-select: none; touch-action: none を付けること。
 */
export function useDragMove({ getInitialPos, onMove, onEnd }: DragMoveOptions): {
  onPointerDown: (e: React.PointerEvent<HTMLElement>) => void
} {
  const latest = useRef({ getInitialPos, onMove, onEnd })
  latest.current = { getInitialPos, onMove, onEnd }

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return
    e.preventDefault() // テキスト選択の開始防止
    const handle = e.currentTarget
    const startX = e.clientX
    const startY = e.clientY
    const initial = latest.current.getInitialPos()
    let pos = initial

    const move = (ev: PointerEvent) => {
      pos = { x: initial.x + ev.clientX - startX, y: initial.y + ev.clientY - startY }
      latest.current.onMove(pos)
    }
    const end = () => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', end)
      handle.removeEventListener('pointercancel', end)
      latest.current.onEnd(pos)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', end)
    handle.addEventListener('pointercancel', end)
    handle.setPointerCapture(e.pointerId)
  }, [])

  return { onPointerDown }
}
