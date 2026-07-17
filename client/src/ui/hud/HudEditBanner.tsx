import { useEffect } from 'react'
import { useAppStore } from '../../state/store'
import { useHudFloat } from './useHudFloat'

/**
 * HUD編集モード中に出る操作バナー。Escapeでも終了できる。
 * HudElementでラップすると編集オーバーレイがボタンを塞ぐため、
 * useHudFloatで自前にドラッグ移動を持つ(位置は'edit-banner'として
 * hudLayoutに永続化し、配置リセットで一緒にデフォルトへ戻る)。
 */
export function HudEditBanner() {
  const setHudEditMode = useAppStore((s) => s.setHudEditMode)
  const resetHudLayout = useAppStore((s) => s.resetHudLayout)
  const addHotbar = useAppStore((s) => s.addHotbar)
  const float = useHudFloat('edit-banner', { h: 'center', v: 'top' })

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setHudEditMode(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [setHudEditMode])

  return (
    <div
      ref={float.ref}
      className="hud-edit-banner"
      style={float.style}
      onPointerDown={(e) => {
        if ((e.target as Element).closest('button')) return
        float.onPointerDown(e)
      }}
    >
      <span>HUD編集中 — ドラッグで移動 / ⚙で設定</span>
      <button type="button" onClick={addHotbar}>
        ホットバーを追加
      </button>
      <button type="button" onClick={resetHudLayout}>
        配置をリセット
      </button>
      <button type="button" onClick={() => setHudEditMode(false)}>
        完了 (Esc)
      </button>
    </div>
  )
}
