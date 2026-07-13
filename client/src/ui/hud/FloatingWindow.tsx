import { useState } from 'react'
import { clampHudPosition, type HudPosition } from '../../state/hudLayout'
import { useDragMove } from './useDragMove'

// クリックしたウィンドウを最前面へ(永続化不要なのでmodule変数で足りる)
let topZ = 100

interface Props {
  title: string
  onClose: () => void
  initialPos: HudPosition
  children: React.ReactNode
}

/** タイトルバーでドラッグ移動できるフローティングウィンドウ(位置は永続化しない) */
export function FloatingWindow({ title, onClose, initialPos, children }: Props) {
  const [pos, setPos] = useState(initialPos)
  const [z, setZ] = useState(() => ++topZ)

  const drag = useDragMove({
    getInitialPos: () => pos,
    onMove: setPos,
    onEnd: (end) =>
      setPos(
        clampHudPosition(
          end,
          { width: 320, height: 200 },
          { width: window.innerWidth, height: window.innerHeight },
        ),
      ),
  })

  return (
    <div
      className="hud-window"
      style={{ left: pos.x, top: pos.y, zIndex: z }}
      onPointerDownCapture={() => setZ(++topZ)}
    >
      <div className="hud-window-title" onPointerDown={drag.onPointerDown}>
        <span>{title}</span>
        {/* pointerdownがタイトルバーに伝播するとドラッグ開始のpointer captureに
            clickを奪われて閉じられなくなるため、ここで止める */}
        <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={onClose}>
          ×
        </button>
      </div>
      <div className="hud-window-body">{children}</div>
    </div>
  )
}
