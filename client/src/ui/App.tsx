import { useEffect, useRef, useState } from 'react'
import { animationKindFromFilename } from '../avatar/animationLoaders'
import { Game } from '../game/Game'
import { useAppStore } from '../state/store'

export function App() {
  const containerRef = useRef<HTMLDivElement>(null)
  const gameRef = useRef<Game | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const avatarName = useAppStore((s) => s.avatarName)
  const status = useAppStore((s) => s.status)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const game = new Game(container)
    gameRef.current = game
    game.start()
    return () => {
      game.dispose()
      gameRef.current = null
    }
  }, [])

  const loadFile = (file: File | undefined) => {
    if (!file) return
    const game = gameRef.current
    if (!game) return
    const kind = animationKindFromFilename(file.name)
    if (kind) {
      void game.loadAnimationFile(file, kind)
    } else {
      void game.loadVRMFile(file)
    }
  }

  return (
    <div
      className="game-container"
      role="application"
      ref={containerRef}
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        loadFile(e.dataTransfer.files[0])
      }}
    >
      <div className="overlay">
        <h1>avatarsquare</h1>
        <div className="hint">右クリック: 移動 / ホイール: ズーム</div>
        <div className="hint">.vrm(アバター) .vrma/.fbx(モーション)をドロップで読み込み</div>
        <div className="hint">walk/idle以外のモーション名はその場で1回再生されます</div>
        {avatarName && <div>アバター: {avatarName}</div>}
        {status && <div className="status">{status}</div>}
        <button type="button" onClick={() => fileInputRef.current?.click()}>
          VRMを開く
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".vrm,.vrma,.fbx"
          style={{ display: 'none' }}
          onChange={(e) => {
            loadFile(e.target.files?.[0])
            e.target.value = ''
          }}
        />
      </div>
      {dragging && <div className="drop-cover">VRMファイルをドロップ</div>}
    </div>
  )
}
