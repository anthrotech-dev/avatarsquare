import { useEffect, useState } from 'react'
import {
  findKeybindConflicts,
  formatKeybind,
  mouseCode,
  type SlotKeybind,
} from '../../state/keybinds'
import { useAppStore } from '../../state/store'
import { FloatingWindow } from './FloatingWindow'

const MODIFIER_CODES = ['Shift', 'Control', 'Alt', 'Meta']

/** ホットバー詳細設定。各スロットのキーバインドを「キーを押して設定」方式で変更する */
export function HotbarConfig({ seq }: { seq: number }) {
  const hotbars = useAppStore((s) => s.hotbars)
  const setHotbarKey = useAppStore((s) => s.setHotbarKey)
  const setHudDetailOpen = useAppStore((s) => s.setHudDetailOpen)
  const [capturing, setCapturing] = useState<number | null>(null)

  // キャプチャ中はcaptureフェーズでkeydown/mousedownを奪い、Game側や他のリスナーに流さない
  useEffect(() => {
    if (capturing === null) return
    const assign = (bind: SlotKeybind) => {
      setHotbarKey({ seq, index: capturing }, bind)
      setCapturing(null)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()
      if (event.key === 'Escape') {
        setCapturing(null)
        return
      }
      // 修飾キー単独は確定にせず押下継続を待つ
      if (MODIFIER_CODES.some((mod) => event.code.startsWith(mod))) return
      assign({
        code: event.code,
        shift: event.shiftKey,
        ctrl: event.ctrlKey,
        alt: event.altKey,
      })
    }
    const onMouseDown = (event: MouseEvent) => {
      // 左クリックはUI操作・対象選択と区別できないため割当対象にしない
      if (event.button === 0) return
      event.preventDefault()
      event.stopPropagation()
      assign({
        code: mouseCode(event.button),
        shift: event.shiftKey,
        ctrl: event.ctrlKey,
        alt: event.altKey,
      })
    }
    // 右クリック確定時のコンテキストメニューや、auxclick経由の既定動作も抑止する
    const swallow = (event: Event) => {
      event.preventDefault()
      event.stopPropagation()
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    window.addEventListener('mousedown', onMouseDown, { capture: true })
    window.addEventListener('contextmenu', swallow, { capture: true })
    window.addEventListener('auxclick', swallow, { capture: true })
    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true })
      window.removeEventListener('mousedown', onMouseDown, { capture: true })
      window.removeEventListener('contextmenu', swallow, { capture: true })
      window.removeEventListener('auxclick', swallow, { capture: true })
    }
  }, [capturing, seq, setHotbarKey])

  const hotbar = hotbars.find((h) => h.seq === seq)
  if (!hotbar) return null

  // キー衝突はactiveなホットバー全体で調べる(非activeのキーは発火しないため対象外)
  const activeHotbars = hotbars.filter((h) => h.active)

  const conflictText = (index: number, bind: SlotKeybind | null): string | null => {
    if (!bind) return null
    const { reserved, conflict } = findKeybindConflicts(activeHotbars, { seq, index }, bind)
    if (reserved) return `${formatKeybind(bind)}は「${reserved}」と衝突しています`
    if (conflict) {
      const where = conflict.seq === seq ? '' : `ホットバー${conflict.seq}の`
      return `${where}スロット${conflict.index + 1}と重複しています`
    }
    return null
  }

  return (
    <FloatingWindow
      title={`ホットバー${seq} 詳細設定`}
      onClose={() => setHudDetailOpen(null)}
      initialPos={{ x: window.innerWidth / 2 - 190, y: window.innerHeight / 2 - 260 }}
    >
      <div className="hud-keybinds">
        {hotbar.keys.map((bind, i) => {
          const conflict = conflictText(i, bind)
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: スロットは固定長・並べ替えなし
            <div key={i} className="hud-keybind-row">
              <span className="hud-keybind-slot">
                {i + 1}. {hotbar.slots[i]?.label ?? '(空)'}
              </span>
              <span className="hud-keybind-key">{formatKeybind(bind) || '未割当'}</span>
              <button type="button" onClick={() => setCapturing(capturing === i ? null : i)}>
                {capturing === i ? 'キー/ボタンを入力... (Esc)' : 'キーを押して設定'}
              </button>
              <button
                type="button"
                disabled={!bind}
                onClick={() => setHotbarKey({ seq, index: i }, null)}
              >
                クリア
              </button>
              {conflict && <span className="hud-keybind-warning">{conflict}</span>}
            </div>
          )
        })}
      </div>
    </FloatingWindow>
  )
}
