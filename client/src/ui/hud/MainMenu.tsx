import { useEffect } from 'react'
import type { HotbarSlot } from '../../state/hotbar'
import { useAppStore } from '../../state/store'
import { FloatingWindow } from './FloatingWindow'
import { PaletteItem } from './PaletteItem'

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

/** 各項目はコマンド。クリックで実行、ドラッグでホットバーへ登録できる */
const MENU_ITEMS: HotbarSlot[] = [
  { command: '/palette', label: 'コマンドパレット' },
  { command: '/hud edit', label: 'HUDレイアウト編集' },
  { command: '/settings', label: '設定' },
]

export function MainMenu() {
  const setMenuOpen = useAppStore((s) => s.setMenuOpen)
  const dispatch = useAppStore((s) => s.dispatch)

  return (
    <FloatingWindow
      title="メニュー"
      onClose={() => setMenuOpen(false)}
      initialPos={{ x: window.innerWidth / 2 - 190, y: window.innerHeight / 2 - 140 }}
    >
      <div className="hud-menu">
        {MENU_ITEMS.map((item) => (
          <PaletteItem
            key={item.command}
            slot={item}
            className="hud-menu-item"
            onActivate={() => {
              setMenuOpen(false)
              void dispatch?.(item.command)
            }}
          />
        ))}
      </div>
    </FloatingWindow>
  )
}
