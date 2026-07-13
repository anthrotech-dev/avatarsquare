import { useEffect, useRef, useState } from 'react'

// VRoid公式の7種VRMA(public/animations/VRMA_0N.vrma)
const EMOTES = [
  { id: 'VRMA_01', label: '全身' },
  { id: 'VRMA_02', label: '挨拶' },
  { id: 'VRMA_03', label: 'ピース' },
  { id: 'VRMA_04', label: '撃つ' },
  { id: 'VRMA_05', label: '回る' },
  { id: 'VRMA_06', label: 'ポーズ' },
  { id: 'VRMA_07', label: '屈伸' },
]

import { animationKindFromFilename } from '../avatar/animationLoaders'
import { Game } from '../game/Game'
import { getTokenEndpoint, saveTokenEndpoint } from '../net/config'
import { useAppStore } from '../state/store'

export function App() {
  const containerRef = useRef<HTMLDivElement>(null)
  const gameRef = useRef<Game | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [endpoint, setEndpoint] = useState(getTokenEndpoint)
  const avatarName = useAppStore((s) => s.avatarName)
  const status = useAppStore((s) => s.status)
  const netStatus = useAppStore((s) => s.netStatus)
  const peers = useAppStore((s) => s.peers)
  const cameraFollow = useAppStore((s) => s.cameraFollow)

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
        <div className="hint">
          Y: カメラ追従/固定の切替 / 固定中は画面端で視点スクロール / Space: キャラ位置へ
        </div>
        <div className="hint">1〜7: エモート</div>
        <div className="hint">.vrm(アバター) .vrma/.fbx(モーション)をドロップで読み込み</div>
        <div className="hint">walk/idle以外のモーション名はその場で1回再生されます</div>
        {avatarName && <div>アバター: {avatarName}</div>}
        <div className="hint">
          {netStatus} / 他{peers}人
        </div>
        <div className="endpoint">
          <input
            value={endpoint}
            spellCheck={false}
            onChange={(e) => setEndpoint(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
          />
          <button
            type="button"
            onClick={() => {
              const saved = saveTokenEndpoint(endpoint)
              setEndpoint(saved)
              void gameRef.current?.reconnect()
            }}
          >
            再接続
          </button>
        </div>
        {status && <div className="status">{status}</div>}
        <button type="button" onClick={() => fileInputRef.current?.click()}>
          VRMを開く
        </button>{' '}
        <button type="button" onClick={() => gameRef.current?.toggleFollow()}>
          カメラ追従: {cameraFollow ? 'ON' : 'OFF'} (Y)
        </button>
        <div className="emotes">
          {EMOTES.map((emote, i) => (
            <button
              key={emote.id}
              type="button"
              onClick={() => void gameRef.current?.playEmote(emote.id)}
            >
              {i + 1}. {emote.label}
            </button>
          ))}
        </div>
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
