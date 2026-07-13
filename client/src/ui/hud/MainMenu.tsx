import { useEffect } from 'react'
import { useAppStore } from '../../state/store'
import { FloatingWindow } from './FloatingWindow'

/**
 * Escで開閉するメインメニュー。各種ウィンドウ・モードへの入口。
 * Escの優先順: HUD編集モード終了(バナー側) > 入力欄 > パレットを閉じる > メニュー開閉
 */
export function useEscMenu(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      const state = useAppStore.getState()
      if (state.hudEditMode) return // HudEditBannerが編集モード終了を担当
      const target = event.target
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return
      if (state.paletteOpen) {
        state.setPaletteOpen(false)
        return
      }
      state.setMenuOpen(!state.menuOpen)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}

export function MainMenu() {
  const setMenuOpen = useAppStore((s) => s.setMenuOpen)
  const setPaletteOpen = useAppStore((s) => s.setPaletteOpen)
  const setHudEditMode = useAppStore((s) => s.setHudEditMode)
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen)

  const openAnd = (fn: () => void) => () => {
    setMenuOpen(false)
    fn()
  }

  return (
    <FloatingWindow
      title="メニュー"
      onClose={() => setMenuOpen(false)}
      initialPos={{ x: window.innerWidth / 2 - 190, y: window.innerHeight / 2 - 140 }}
    >
      <div className="hud-menu">
        <button type="button" onClick={openAnd(() => setPaletteOpen(true))}>
          コマンドパレット
        </button>
        <button type="button" onClick={openAnd(() => setHudEditMode(true))}>
          HUDレイアウト編集
        </button>
        <button type="button" onClick={openAnd(() => setSettingsOpen(true))}>
          設定
        </button>
        <button type="button" onClick={() => setMenuOpen(false)}>
          閉じる (Esc)
        </button>
      </div>
    </FloatingWindow>
  )
}
