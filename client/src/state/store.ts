import { create } from 'zustand'
import { sanitizeName } from '../net/protocol'
import {
  activateHotbar,
  deactivateHotbar,
  type HotbarData,
  type HotbarSlot,
  loadHotbars,
  saveHotbars,
} from './hotbar'
import {
  type HudElementId,
  type HudLayout,
  type HudPosition,
  type HudVisibility,
  loadHudLayout,
  loadHudVisibility,
  saveHudLayout,
  saveHudVisibility,
} from './hudLayout'
import type { SlotKeybind } from './keybinds'

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

/** ホットバー内の1スロットの位置 */
export interface SlotRef {
  seq: number
  index: number
}

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
  /** 全ホットバー(非アクティブ=表示から削除済みの設定も保持する) */
  hotbars: HotbarData[]
  chatLog: ChatEntry[]
  /** マクロ一覧の更新通知(MacroStore.onChangeから) */
  macrosVersion: number
  /** /chatコマンドからのフォーカス要求。ChatWindowが購読する */
  chatFocusVersion: number
  /** /vrm openコマンドからのファイル選択要求。Appが購読する */
  vrmPickerVersion: number
  settingsOpen: boolean
  /** HUD要素のカスタム配置(キーが無い要素はデフォルト位置) */
  hudLayout: HudLayout
  /** HUD要素の表示/非表示(キーが無い要素は表示) */
  hudVisibility: HudVisibility
  /** HUD編集モード中はゲーム入力を止め、HUD要素をドラッグ移動できる */
  hudEditMode: boolean
  /** ホットバー詳細設定ウィンドウの対象seq(null=閉じている) */
  hudDetailOpen: number | null
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
  setHotbarSlot: (ref: SlotRef, slot: HotbarSlot | null) => void
  swapHotbarSlots: (a: SlotRef, b: SlotRef) => void
  setHotbarKey: (ref: SlotRef, bind: SlotKeybind | null) => void
  addHotbar: () => void
  removeHotbar: (seq: number) => void
  appendChat: (entry: Omit<ChatEntry, 'id'>) => void
  bumpMacros: () => void
  requestChatFocus: () => void
  requestVrmPicker: () => void
  setSettingsOpen: (settingsOpen: boolean) => void
  setHudPosition: (id: HudElementId, pos: HudPosition | null) => void
  setHudVisibility: (id: HudElementId, visible: boolean) => void
  resetHudLayout: () => void
  setHudEditMode: (on: boolean) => void
  setHudDetailOpen: (seq: number | null) => void
  setPaletteOpen: (paletteOpen: boolean) => void
  setMenuOpen: (menuOpen: boolean) => void
}

/** seqのホットバーだけをupdaterで差し替えた新しい配列を返す */
function updateHotbar(
  hotbars: HotbarData[],
  seq: number,
  updater: (hotbar: HotbarData) => HotbarData,
): HotbarData[] {
  return hotbars.map((h) => (h.seq === seq ? updater(h) : h))
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
  hotbars: loadHotbars(),
  chatLog: [],
  macrosVersion: 0,
  chatFocusVersion: 0,
  vrmPickerVersion: 0,
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
  setHotbarSlot: (ref, slot) =>
    set((state) => {
      const hotbars = updateHotbar(state.hotbars, ref.seq, (h) => {
        const slots = [...h.slots]
        slots[ref.index] = slot
        return { ...h, slots }
      })
      saveHotbars(hotbars)
      return { hotbars }
    }),
  swapHotbarSlots: (a, b) =>
    set((state) => {
      const slotAt = (ref: SlotRef) =>
        state.hotbars.find((h) => h.seq === ref.seq)?.slots[ref.index] ?? null
      const valueA = slotAt(a)
      const valueB = slotAt(b)
      let hotbars = updateHotbar(state.hotbars, a.seq, (h) => {
        const slots = [...h.slots]
        slots[a.index] = valueB
        return { ...h, slots }
      })
      hotbars = updateHotbar(hotbars, b.seq, (h) => {
        const slots = [...h.slots]
        slots[b.index] = valueA
        return { ...h, slots }
      })
      saveHotbars(hotbars)
      return { hotbars }
    }),
  setHotbarKey: (ref, bind) =>
    set((state) => {
      const hotbars = updateHotbar(state.hotbars, ref.seq, (h) => {
        const keys = [...h.keys]
        keys[ref.index] = bind
        return { ...h, keys }
      })
      saveHotbars(hotbars)
      return { hotbars }
    }),
  addHotbar: () =>
    set((state) => {
      const hotbars = activateHotbar(state.hotbars)
      saveHotbars(hotbars)
      return { hotbars }
    }),
  removeHotbar: (seq) =>
    set((state) => {
      const hotbars = deactivateHotbar(state.hotbars, seq)
      saveHotbars(hotbars)
      return { hotbars, hudDetailOpen: state.hudDetailOpen === seq ? null : state.hudDetailOpen }
    }),
  appendChat: (entry) =>
    set((state) => ({
      chatLog: [...state.chatLog, { ...entry, id: chatId++ }].slice(-CHAT_LOG_LIMIT),
    })),
  bumpMacros: () => set((state) => ({ macrosVersion: state.macrosVersion + 1 })),
  requestChatFocus: () => set((state) => ({ chatFocusVersion: state.chatFocusVersion + 1 })),
  requestVrmPicker: () => set((state) => ({ vrmPickerVersion: state.vrmPickerVersion + 1 })),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setHudPosition: (id, pos) =>
    set((state) => {
      const hudLayout = { ...state.hudLayout }
      if (pos) hudLayout[id] = pos
      else delete hudLayout[id]
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
    const hudLayout: HudLayout = {}
    const hudVisibility: HudVisibility = {}
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
