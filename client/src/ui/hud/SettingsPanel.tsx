import { Room } from 'livekit-client'
import { useEffect, useRef, useState } from 'react'
import type { Game } from '../../game/Game'
import { getTokenEndpoint, saveTokenEndpoint } from '../../net/config'
import type { HotbarSlot } from '../../state/hotbar'
import { useAppStore } from '../../state/store'
import { loadMicDeviceId, meterPosToRms, rmsToMeterPos } from '../../state/voice'
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
        <MicDevicePicker game={game} />
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

/**
 * ボイスチャットのマイクデバイス選択。選択は保存され、VC参加中は即時切替、
 * VC OFF中でも次回の/vc onに適用される。
 * デバイス名(label)はマイク許可を与えるまで空になるブラウザが多い。
 */
function MicDevicePicker({ game }: { game: Game | null }) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [selected, setSelected] = useState(loadMicDeviceId)

  useEffect(() => {
    // requestPermissions=falseで列挙のみ(許可プロンプトは/vc onに委ねる)
    Room.getLocalDevices('audioinput', false)
      .then(setDevices)
      .catch(() => setDevices([]))
  }, [])

  return (
    <div className="hud-settings-section">
      <div className="hud-settings-label">マイク(ボイスチャット)</div>
      <div className="hud-settings-row">
        <select
          className="hud-voice-device"
          value={selected}
          onChange={(e) => {
            setSelected(e.target.value)
            void game?.setMicDevice(e.target.value)
          }}
        >
          <option value="">既定のマイク</option>
          {devices.map((device, i) => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label || `マイク ${i + 1}(名前はVC参加後に表示)`}
            </option>
          ))}
        </select>
      </div>
      <NoiseGatePicker game={game} />
    </div>
  )
}

/**
 * ノイズゲート(入力感度)。現在のマイク音量がスライダーの背後にメーターで流れ、
 * スライダー(黄色いつまみ)をメーターの振れに合わせることで視覚的に閾値を決める。
 * つまみより右までメーターが振れた音だけが送信される(Discordの入力感度と同じ)。
 * メーターはVC参加中のみ動く(ミュート中も動くので調整できる)。
 */
function NoiseGatePicker({ game }: { game: Game | null }) {
  const noiseGate = useAppStore((s) => s.noiseGate)
  const setNoiseGate = useAppStore((s) => s.setNoiseGate)
  const voiceEnabled = useAppStore((s) => s.voiceEnabled)
  const fillRef = useRef<HTMLDivElement>(null)
  // rAFループから最新の閾値を参照するため(依存に入れるとループが毎回張り直しになる)
  const gateRef = useRef(noiseGate)
  gateRef.current = noiseGate

  // メーターはstoreを介さずrAFでDOM直接更新する(毎フレームのReact再レンダを避ける)
  useEffect(() => {
    const fill = fillRef.current
    if (!fill) return
    if (!game || !voiceEnabled) {
      fill.style.width = '0%'
      fill.classList.remove('open')
      return
    }
    let raf = 0
    const tick = () => {
      const level = game.getMicLevel()
      fill.style.width = `${rmsToMeterPos(level) * 100}%`
      // ゲートが開く(=送信される)音量なら緑、下回るならグレー
      fill.classList.toggle('open', level > 0 && level >= gateRef.current)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [game, voiceEnabled])

  return (
    <>
      <div className="hud-settings-label">
        入力感度(ノイズゲート) — つまみより右に振れた音だけ送信されます
      </div>
      <div className="hud-gate">
        <div className="hud-gate-meter">
          <div ref={fillRef} className="hud-gate-fill" />
        </div>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={rmsToMeterPos(noiseGate)}
          onChange={(e) => setNoiseGate(meterPosToRms(Number(e.target.value)))}
        />
      </div>
      {!voiceEnabled && (
        <div className="hud-settings-hints">メーターはVC参加中(/vc on)に動きます</div>
      )}
    </>
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
