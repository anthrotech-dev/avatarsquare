import { useEffect } from 'react'
import { useAppStore } from '../../state/store'

/** HUD編集モード中に画面上部へ出るバナー。Escapeでも終了できる */
export function HudEditBanner() {
  const setHudEditMode = useAppStore((s) => s.setHudEditMode)
  const resetHudLayout = useAppStore((s) => s.resetHudLayout)
  const addHotbar = useAppStore((s) => s.addHotbar)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setHudEditMode(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [setHudEditMode])

  return (
    <div className="hud-edit-banner">
      <span>HUD編集中 — ドラッグで移動 / 右クリックで設定</span>
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
