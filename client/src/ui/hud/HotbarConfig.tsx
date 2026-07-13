import { useEffect, useState } from 'react'
import { findKeybindConflicts, formatKeybind, type SlotKeybind } from '../../state/keybinds'
import { useAppStore } from '../../state/store'
import { FloatingWindow } from './FloatingWindow'

const MODIFIER_CODES = ['Shift', 'Control', 'Alt', 'Meta']

/** ホットバー詳細設定。各スロットのキーバインドを「キーを押して設定」方式で変更する */
export function HotbarConfig() {
  const hotbar = useAppStore((s) => s.hotbar)
  const hotbarKeys = useAppStore((s) => s.hotbarKeys)
  const setHotbarKey = useAppStore((s) => s.setHotbarKey)
  const setHudDetailOpen = useAppStore((s) => s.setHudDetailOpen)
  const [capturing, setCapturing] = useState<number | null>(null)

  // キャプチャ中はcaptureフェーズでkeydownを奪い、Game側や他のリスナーに流さない
  useEffect(() => {
    if (capturing === null) return
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()
      if (event.key === 'Escape') {
        setCapturing(null)
        return
      }
      // 修飾キー単独は確定にせず押下継続を待つ
      if (MODIFIER_CODES.some((mod) => event.code.startsWith(mod))) return
      setHotbarKey(capturing, {
        code: event.code,
        shift: event.shiftKey,
        ctrl: event.ctrlKey,
        alt: event.altKey,
      })
      setCapturing(null)
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [capturing, setHotbarKey])

  const conflictText = (index: number, bind: SlotKeybind | null): string | null => {
    if (!bind) return null
    const { reserved, slotIndex } = findKeybindConflicts(hotbarKeys, index, bind)
    if (reserved) return `${formatKeybind(bind)}は「${reserved}」と衝突しています`
    if (slotIndex !== null) return `スロット${slotIndex === 9 ? 0 : slotIndex + 1}と重複しています`
    return null
  }

  return (
    <FloatingWindow
      title="ホットバー詳細設定"
      onClose={() => setHudDetailOpen(null)}
      initialPos={{ x: window.innerWidth / 2 - 190, y: window.innerHeight / 2 - 260 }}
    >
      <div className="hud-keybinds">
        {hotbarKeys.map((bind, i) => {
          const conflict = conflictText(i, bind)
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: スロットは固定長・並べ替えなし
            <div key={i} className="hud-keybind-row">
              <span className="hud-keybind-slot">
                {i === 9 ? 0 : i + 1}. {hotbar[i]?.label ?? '(空)'}
              </span>
              <span className="hud-keybind-key">{formatKeybind(bind) || '未割当'}</span>
              <button type="button" onClick={() => setCapturing(capturing === i ? null : i)}>
                {capturing === i ? 'キーを入力... (Esc)' : 'キーを押して設定'}
              </button>
              <button type="button" disabled={!bind} onClick={() => setHotbarKey(i, null)}>
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
