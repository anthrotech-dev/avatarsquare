import { create } from 'zustand'
import { sanitizeName } from '../net/protocol'
import { type HotbarSlot, loadHotbar, saveHotbar, swapSlots } from './hotbar'
import {
  DEFAULT_HUD_LAYOUT,
  DEFAULT_HUD_VISIBILITY,
  type HudElementId,
  type HudLayout,
  type HudPosition,
  type HudVisibility,
  loadHudLayout,
  loadHudVisibility,
  saveHudLayout,
  saveHudVisibility,
} from './hudLayout'
import { loadKeybinds, type SlotKeybind, saveKeybinds } from './keybinds'

const NAME_STORAGE_KEY = 'avatarsquare:name'

function loadPlayerName(): string {
  try {
    return sanitizeName(localStorage.getItem(NAME_STORAGE_KEY) ?? '')
  } catch {
    return ''
  }
}

export interface ChatEntry {
  id: number
  kind: 'system' | 'error' | 'echo' | 'chat'
  text: string
  /** 発言者の表示名(kind:'chat'のみ) */
  from?: string
}

const CHAT_LOG_LIMIT = 200

let chatId = 0

interface AppState {
  avatarName: string | null
  /** ユーザーが設定した表示名。空ならVRM名を代用する */
  playerName: string
  status: string
  netStatus: string
  peers: number
  cameraFollow: boolean
  /** コマンド実行の入口。Gameが接続時に注入する */
  dispatch: ((line: string) => Promise<void>) | null
  /** 現在座標。Gameが0.2秒スロットルで更新する(毎フレーム更新は再レンダ嵐になる) */
  position: { x: number; z: number }
  hotbar: (HotbarSlot | null)[]
  /** 各スロットのキーバインド */
  hotbarKeys: (SlotKeybind | null)[]
  chatLog: ChatEntry[]
  /** マクロ一覧の更新通知(MacroStore.onChangeから) */
  macrosVersion: number
  settingsOpen: boolean
  /** HUD要素のカスタム配置(null=デフォルト位置) */
  hudLayout: HudLayout
  /** HUD要素の表示/非表示 */
  hudVisibility: HudVisibility
  /** HUD編集モード中はゲーム入力を止め、HUD要素をドラッグ移動できる */
  hudEditMode: boolean
  /** HUD要素の詳細設定ウィンドウ(現状ホットバーのみ) */
  hudDetailOpen: 'hotbar' | null
  paletteOpen: boolean
  /** Escで開くメインメニュー */
  menuOpen: boolean
  setAvatarName: (name: string | null) => void
  setPlayerName: (name: string) => void
  setStatus: (status: string) => void
  setNetStatus: (netStatus: string) => void
  setPeers: (peers: number) => void
  setCameraFollow: (cameraFollow: boolean) => void
  setDispatch: (dispatch: AppState['dispatch']) => void
  setPosition: (position: { x: number; z: number }) => void
  setHotbarSlot: (index: number, slot: HotbarSlot | null) => void
  swapHotbarSlots: (a: number, b: number) => void
  setHotbarKey: (index: number, bind: SlotKeybind | null) => void
  appendChat: (entry: Omit<ChatEntry, 'id'>) => void
  bumpMacros: () => void
  setSettingsOpen: (settingsOpen: boolean) => void
  setHudPosition: (id: HudElementId, pos: HudPosition | null) => void
  setHudVisibility: (id: HudElementId, visible: boolean) => void
  resetHudLayout: () => void
  setHudEditMode: (on: boolean) => void
  setHudDetailOpen: (id: 'hotbar' | null) => void
  setPaletteOpen: (paletteOpen: boolean) => void
  setMenuOpen: (menuOpen: boolean) => void
}

export const useAppStore = create<AppState>((set) => ({
  avatarName: null,
  playerName: loadPlayerName(),
  status: '',
  netStatus: 'オフライン',
  peers: 0,
  cameraFollow: true,
  dispatch: null,
  position: { x: 0, z: 0 },
  hotbar: loadHotbar(),
  hotbarKeys: loadKeybinds(),
  chatLog: [],
  macrosVersion: 0,
  settingsOpen: false,
  hudLayout: loadHudLayout(),
  hudVisibility: loadHudVisibility(),
  hudEditMode: false,
  hudDetailOpen: null,
  paletteOpen: false,
  menuOpen: false,
  setAvatarName: (avatarName) => set({ avatarName }),
  setPlayerName: (name) => {
    const playerName = sanitizeName(name)
    try {
      localStorage.setItem(NAME_STORAGE_KEY, playerName)
    } catch {
      // 保存できなくてもセッション中は有効
    }
    set({ playerName })
  },
  setStatus: (status) => set({ status }),
  setNetStatus: (netStatus) => set({ netStatus }),
  setPeers: (peers) => set({ peers }),
  setCameraFollow: (cameraFollow) => set({ cameraFollow }),
  setDispatch: (dispatch) => set({ dispatch }),
  setPosition: (position) => set({ position }),
  setHotbarSlot: (index, slot) =>
    set((state) => {
      const hotbar = [...state.hotbar]
      hotbar[index] = slot
      saveHotbar(hotbar)
      return { hotbar }
    }),
  swapHotbarSlots: (a, b) =>
    set((state) => {
      const hotbar = swapSlots(state.hotbar, a, b)
      saveHotbar(hotbar)
      return { hotbar }
    }),
  setHotbarKey: (index, bind) =>
    set((state) => {
      const hotbarKeys = [...state.hotbarKeys]
      hotbarKeys[index] = bind
      saveKeybinds(hotbarKeys)
      return { hotbarKeys }
    }),
  appendChat: (entry) =>
    set((state) => ({
      chatLog: [...state.chatLog, { ...entry, id: chatId++ }].slice(-CHAT_LOG_LIMIT),
    })),
  bumpMacros: () => set((state) => ({ macrosVersion: state.macrosVersion + 1 })),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setHudPosition: (id, pos) =>
    set((state) => {
      const hudLayout = { ...state.hudLayout, [id]: pos }
      saveHudLayout(hudLayout)
      return { hudLayout }
    }),
  setHudVisibility: (id, visible) =>
    set((state) => {
      const hudVisibility = { ...state.hudVisibility, [id]: visible }
      saveHudVisibility(hudVisibility)
      return { hudVisibility }
    }),
  resetHudLayout: () => {
    const hudLayout = { ...DEFAULT_HUD_LAYOUT }
    const hudVisibility = { ...DEFAULT_HUD_VISIBILITY }
    saveHudLayout(hudLayout)
    saveHudVisibility(hudVisibility)
    set({ hudLayout, hudVisibility })
  },
  setHudEditMode: (hudEditMode) =>
    set(hudEditMode ? { hudEditMode } : { hudEditMode, hudDetailOpen: null }),
  setHudDetailOpen: (hudDetailOpen) => set({ hudDetailOpen }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setMenuOpen: (menuOpen) => set({ menuOpen }),
}))
