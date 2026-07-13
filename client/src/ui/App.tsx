import { useEffect, useRef, useState } from 'react'
import { animationKindFromFilename } from '../avatar/animationLoaders'
import { Game } from '../game/Game'
import { useAppStore } from '../state/store'
import { ChatWindow } from './hud/ChatWindow'
import { CommandPalette } from './hud/CommandPalette'
import { Hotbar } from './hud/Hotbar'
import { HotbarConfig } from './hud/HotbarConfig'
import { HudEditBanner } from './hud/HudEditBanner'
import { HudElement } from './hud/HudElement'
import { MainMenu, useEscMenu } from './hud/MainMenu'
import { PlayersWindow } from './hud/PlayersWindow'
import { SettingsWindow } from './hud/SettingsPanel'
import { StatusPanel } from './hud/StatusPanel'

export function App() {
  const containerRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [game, setGame] = useState<Game | null>(null)
  const [dragging, setDragging] = useState(false)
  const paletteOpen = useAppStore((s) => s.paletteOpen)
  const hudEditMode = useAppStore((s) => s.hudEditMode)
  const hudDetailOpen = useAppStore((s) => s.hudDetailOpen)
  const menuOpen = useAppStore((s) => s.menuOpen)
  const settingsOpen = useAppStore((s) => s.settingsOpen)
  const playersOpen = useAppStore((s) => s.playersOpen)
  const hotbars = useAppStore((s) => s.hotbars)
  const setHudDetailOpen = useAppStore((s) => s.setHudDetailOpen)
  const removeHotbar = useAppStore((s) => s.removeHotbar)
  const vrmPickerVersion = useAppStore((s) => s.vrmPickerVersion)
  useEscMenu()

  // /vrm openコマンドからのファイル選択要求
  useEffect(() => {
    if (vrmPickerVersion > 0) fileInputRef.current?.click()
  }, [vrmPickerVersion])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const newGame = new Game(container)
    setGame(newGame)
    newGame.start()
    return () => {
      newGame.dispose()
      setGame(null)
    }
  }, [])

  const loadFile = (file: File | undefined) => {
    if (!file || !game) return
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
        // pragmatic-drag-and-drop(スロット等)の内部ドラッグには反応しない
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        setDragging(false)
        loadFile(e.dataTransfer.files[0])
      }}
    >
      <HudElement id="status" label="ステータス">
        <StatusPanel />
      </HudElement>
      <HudElement id="chat" label="チャット">
        <ChatWindow />
      </HudElement>
      {hotbars
        .filter((h) => h.active)
        .map((h, i) => ({ hotbar: h, stack: i }))
        // 逆順で描画: 下のバーの編集ラベル(上に出る)が上のバーに隠れないように
        .reverse()
        .map(({ hotbar: h, stack }) => (
          <HudElement
            key={h.seq}
            id={`hotbar-${h.seq}`}
            label={`ホットバー${h.seq}`}
            anchorClass="hud-anchor-hotbar"
            anchorStyle={{ '--hud-stack': stack } as React.CSSProperties}
            menuItems={[
              { label: 'キー設定...', onClick: () => setHudDetailOpen(h.seq) },
              { label: 'このホットバーを削除', onClick: () => removeHotbar(h.seq) },
            ]}
          >
            <Hotbar seq={h.seq} />
          </HudElement>
        ))}
      {settingsOpen && <SettingsWindow game={game} />}
      {playersOpen && <PlayersWindow />}
      {menuOpen && <MainMenu />}
      {paletteOpen && <CommandPalette macroStore={game?.macroStore ?? null} />}
      {hudEditMode && <HudEditBanner />}
      {hudDetailOpen !== null && <HotbarConfig seq={hudDetailOpen} />}
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
      {dragging && <div className="drop-cover">VRMファイルをドロップ</div>}
    </div>
  )
}
