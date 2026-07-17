import { useState } from 'react'
import type { MacroStore } from '../../command/macros'
import type { HotbarSlot } from '../../state/hotbar'
import { useAppStore } from '../../state/store'
import { EMOTES } from './emotes'
import { FloatingWindow } from './FloatingWindow'
import { PaletteItem } from './PaletteItem'

/** ホットバーに割り当てられる組み込みコマンドの一覧 */
const ACTIONS: HotbarSlot[] = [
  { command: '/jump', label: 'ジャンプ' },
  { command: '/attack', label: '斬撃' },
  { command: '/shoot', label: '射撃' },
  { command: '/dash', label: 'ダッシュ' },
  { command: '/stop', label: '停止' },
  { command: '/where', label: '座標表示' },
  { command: '/camera toggle', label: 'カメラ切替' },
  { command: '/camera follow', label: 'カメラ追従' },
  { command: '/camera fixed', label: 'カメラ固定' },
  { command: '/camera snap', label: 'キャラへ視点' },
  { command: '/zoom 3', label: 'ズーム寄り' },
  { command: '/zoom 9', label: 'ズーム標準' },
  { command: '/zoom 20', label: 'ズーム引き' },
  { command: '/hud edit', label: 'HUD編集' },
  { command: '/settings', label: '設定' },
  { command: '/players', label: 'プレイヤー一覧' },
  { command: '/chat', label: 'チャット入力' },
  { command: '/vrm open', label: 'VRMを開く' },
  { command: '/vrm clear', label: 'VRMキャッシュ削除' },
  { command: '/help', label: 'ヘルプ' },
]

interface Props {
  macroStore: MacroStore | null
}

/**
 * コマンドパレット。項目をホットバーのスロットへドラッグ&ドロップして登録する。
 * /palette またはメニュー(Esc)から開く。
 */
export function CommandPalette({ macroStore }: Props) {
  const setPaletteOpen = useAppStore((s) => s.setPaletteOpen)
  const macrosVersion = useAppStore((s) => s.macrosVersion)
  const [freeCommand, setFreeCommand] = useState('')
  const [freeLabel, setFreeLabel] = useState('')

  const macros = macroStore?.list() ?? []
  void macrosVersion // 依存: マクロ保存/削除で再レンダさせる

  const freeSlot: HotbarSlot | null = freeCommand.trim().startsWith('/')
    ? { command: freeCommand.trim(), label: freeLabel.trim() || freeCommand.trim() }
    : null

  return (
    <FloatingWindow
      title="コマンドパレット — スロットへドラッグで登録"
      onClose={() => setPaletteOpen(false)}
      initialPos={{ x: window.innerWidth / 2 + 200, y: window.innerHeight - 460 }}
    >
      <div className="hud-palette">
        <div className="hud-palette-section">アクション</div>
        <div className="hud-palette-grid">
          {ACTIONS.map((action) => (
            <PaletteItem key={action.command} slot={action} />
          ))}
        </div>
        <div className="hud-palette-section">エモート</div>
        <div className="hud-palette-grid">
          {EMOTES.map((emote) => (
            <PaletteItem
              key={emote.id}
              slot={{ command: `/emote ${emote.id}`, label: emote.label }}
            />
          ))}
        </div>
        <div className="hud-palette-section">マクロ</div>
        <div className="hud-palette-grid">
          {macros.length === 0 ? (
            <div className="hud-palette-empty">設定(/settings)でマクロを作成できます</div>
          ) : (
            macros.map((macro) => (
              <PaletteItem
                key={macro.name}
                slot={{ command: `/macro ${macro.name}`, label: macro.name }}
              />
            ))
          )}
        </div>
        <div className="hud-palette-section">自由入力</div>
        <div className="hud-palette-free">
          <input
            placeholder="/コマンド 引数"
            value={freeCommand}
            spellCheck={false}
            onChange={(e) => setFreeCommand(e.target.value)}
          />
          <input
            placeholder="ラベル"
            value={freeLabel}
            onChange={(e) => setFreeLabel(e.target.value)}
          />
          {freeSlot ? (
            <PaletteItem slot={freeSlot} />
          ) : (
            <div className="hud-palette-empty">「/」始まりで入力するとドラッグできます</div>
          )}
        </div>
      </div>
    </FloatingWindow>
  )
}
