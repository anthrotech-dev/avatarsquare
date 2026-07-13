import { useState } from 'react'
import type { Game } from '../../game/Game'
import { getTokenEndpoint, saveTokenEndpoint } from '../../net/config'
import type { HotbarSlot } from '../../state/hotbar'
import { useAppStore } from '../../state/store'
import { FloatingWindow } from './FloatingWindow'
import { PaletteItem } from './PaletteItem'

interface Props {
  game: Game | null
}

/** 各種操作はコマンド。クリックで実行、ドラッグでホットバーへ登録できる */
const SETTINGS_ACTIONS: HotbarSlot[] = [
  { command: '/vrm open', label: 'VRMを開く' },
  { command: '/camera toggle', label: 'カメラ切替' },
  { command: '/camera snap', label: 'キャラへ視点' },
  { command: '/vrm clear', label: 'VRMキャッシュ削除' },
  { command: '/hud edit', label: 'HUD編集' },
]

/** 設定ウィンドウ。/settings(ホットバー・メニュー(Esc))から開く */
export function SettingsWindow({ game }: Props) {
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen)
  const dispatch = useAppStore((s) => s.dispatch)
  const playerName = useAppStore((s) => s.playerName)
  const setPlayerName = useAppStore((s) => s.setPlayerName)
  const [endpoint, setEndpoint] = useState(getTokenEndpoint)
  const [nameInput, setNameInput] = useState(playerName)

  return (
    <FloatingWindow
      title="設定"
      onClose={() => setSettingsOpen(false)}
      initialPos={{ x: window.innerWidth / 2 - 190, y: window.innerHeight / 2 - 280 }}
    >
      <div className="hud-settings-content">
        <div className="hud-settings-section">
          <div className="hud-settings-label">プレイヤー名(頭上に表示)</div>
          <div className="hud-settings-row">
            <input
              placeholder="未設定時はVRMのモデル名"
              value={nameInput}
              spellCheck={false}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') setPlayerName(nameInput)
              }}
            />
            <button type="button" onClick={() => setPlayerName(nameInput)}>
              保存
            </button>
          </div>
        </div>
        <div className="hud-settings-section">
          <div className="hud-settings-label">トークンサーバー</div>
          <div className="hud-settings-row">
            <input
              value={endpoint}
              spellCheck={false}
              onChange={(e) => setEndpoint(e.target.value)}
            />
            <button
              type="button"
              onClick={() => {
                const saved = saveTokenEndpoint(endpoint)
                setEndpoint(saved)
                void game?.reconnect()
              }}
            >
              再接続
            </button>
          </div>
        </div>
        <div className="hud-settings-section">
          <div className="hud-settings-label">
            操作(クリックで実行 / ホットバーへドラッグで登録)
          </div>
          <div className="hud-settings-row">
            {SETTINGS_ACTIONS.map((action) => (
              <PaletteItem
                key={action.command}
                slot={action}
                onActivate={() => {
                  // HUD編集は設定ウィンドウが被ったままだと編集できないので閉じる
                  if (action.command === '/hud edit') setSettingsOpen(false)
                  void dispatch?.(action.command)
                }}
              />
            ))}
          </div>
        </div>
        <MacroEditor game={game} />
        <div className="hud-settings-section hud-settings-hints">
          <div>右クリック: 移動 / ホイール: ズーム / Esc: メニュー</div>
          <div>
            1〜9,0,Space,Enter:
            ホットバー(コマンドパレット(/palette)からドラッグで割当、スロット間はドラッグで入替)
          </div>
          <div>
            HUDレイアウト編集(/hud
            edit)で要素の移動、ホットバーの追加・削除、右クリックで非表示・キー割当ができます
          </div>
          <div>カメラ固定中は画面端で視点スクロール(/camera で切替)</div>
          <div>コマンドは「/」始まり(/help で一覧)</div>
          <div>.vrm(アバター) .vrma/.fbx(モーション)をドロップで読み込み</div>
          <div>jump/slash/shoot/walk/idle の名前のモーションは対応アクションを差し替えます</div>
        </div>
      </div>
    </FloatingWindow>
  )
}

/** マクロの作成・編集。保存するとホットバーやコマンドから実行できる */
function MacroEditor({ game }: { game: Game | null }) {
  const macrosVersion = useAppStore((s) => s.macrosVersion)
  const [name, setName] = useState('')
  const [lines, setLines] = useState('')

  const store = game?.macroStore ?? null
  const macros = store?.list() ?? []
  void macrosVersion // 依存: 保存/削除で一覧を更新する

  const select = (macroName: string) => {
    const macro = store?.get(macroName)
    if (!macro) return
    setName(macro.name)
    setLines(macro.lines.join('\n'))
  }

  const save = () => {
    const trimmed = name.trim()
    if (!store || !trimmed) return
    store.save({ name: trimmed, lines: lines.split('\n') })
  }

  return (
    <div className="hud-settings-section">
      <div className="hud-settings-label">マクロ</div>
      {macros.length > 0 && (
        <div className="hud-settings-row hud-macro-list">
          {macros.map((macro) => (
            <button key={macro.name} type="button" onClick={() => select(macro.name)}>
              {macro.name}
            </button>
          ))}
        </div>
      )}
      <div className="hud-settings-row">
        <input
          placeholder="マクロ名"
          value={name}
          spellCheck={false}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <textarea
        placeholder={'1行1コマンド 例:\n/emote VRMA_02\n/wait 1\n/jump'}
        value={lines}
        rows={4}
        spellCheck={false}
        onChange={(e) => setLines(e.target.value)}
      />
      <div className="hud-settings-row">
        <button type="button" disabled={!name.trim()} onClick={save}>
          保存
        </button>
        <button
          type="button"
          disabled={!store?.get(name.trim())}
          onClick={() => {
            store?.remove(name.trim())
            setName('')
            setLines('')
          }}
        >
          削除
        </button>
      </div>
    </div>
  )
}
