import { useState } from 'react'
import { clearCachedVRM } from '../../avatar/vrmCache'
import type { Game } from '../../game/Game'
import { getTokenEndpoint, saveTokenEndpoint } from '../../net/config'
import { useAppStore } from '../../state/store'
import { FloatingWindow } from './FloatingWindow'

/**
 * 設定を開く⚙ボタン。HUD要素として移動・非表示にできる
 * (非表示にしてもEsc→メニュー→設定から開ける)。
 */
export function SettingsButton() {
  const settingsOpen = useAppStore((s) => s.settingsOpen)
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen)

  return (
    <button
      type="button"
      className="hud-settings-toggle"
      title="設定"
      onClick={() => setSettingsOpen(!settingsOpen)}
    >
      ⚙
    </button>
  )
}

interface Props {
  game: Game | null
  onOpenVRM: () => void
}

/** 設定ウィンドウ。⚙ボタンまたはメニュー(Esc)から開く */
export function SettingsWindow({ game, onOpenVRM }: Props) {
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen)
  const cameraFollow = useAppStore((s) => s.cameraFollow)
  const dispatch = useAppStore((s) => s.dispatch)
  const playerName = useAppStore((s) => s.playerName)
  const setPlayerName = useAppStore((s) => s.setPlayerName)
  const setHudEditMode = useAppStore((s) => s.setHudEditMode)
  const [endpoint, setEndpoint] = useState(getTokenEndpoint)
  const [nameInput, setNameInput] = useState(playerName)

  return (
    <FloatingWindow
      title="設定"
      onClose={() => setSettingsOpen(false)}
      initialPos={{ x: window.innerWidth - 400, y: 56 }}
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
          <div className="hud-settings-row">
            <button type="button" onClick={onOpenVRM}>
              VRMを開く
            </button>
            <button type="button" onClick={() => void dispatch?.('/camera toggle')}>
              カメラ追従: {cameraFollow ? 'ON' : 'OFF'} (Y)
            </button>
            <button type="button" onClick={() => void dispatch?.('/camera snap')}>
              カメラをキャラへ
            </button>
            <button
              type="button"
              onClick={() =>
                void clearCachedVRM().then(() =>
                  useAppStore.getState().setStatus('キャッシュしたVRMを削除しました'),
                )
              }
            >
              VRMキャッシュを削除
            </button>
            <button
              type="button"
              onClick={() => {
                setHudEditMode(true)
                setSettingsOpen(false)
              }}
            >
              HUDレイアウト編集
            </button>
          </div>
        </div>
        <MacroEditor game={game} />
        <div className="hud-settings-section hud-settings-hints">
          <div>右クリック: 移動 / ホイール: ズーム / Space: ジャンプ / Esc: メニュー</div>
          <div>
            1〜9,0:
            ホットバー(メニューのコマンドパレットからドラッグで割当、スロット間はドラッグで入替)
          </div>
          <div>HUDレイアウト編集(/hud edit)で要素の移動・非表示とキー割当変更ができます</div>
          <div>Y: カメラ追従/固定 / 固定中は画面端で視点スクロール</div>
          <div>Enter: チャット入力 / コマンドは「/」始まり(/help で一覧)</div>
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
