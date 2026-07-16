import { vi } from 'vitest'
import type { CommandContext, GameCommandAPI } from './types'

/** テスト用のモックAPIと出力収集を備えたCommandContext */
export function makeTestContext(overrides: Partial<GameCommandAPI> = {}): {
  ctx: CommandContext
  api: GameCommandAPI
  printed: string[]
  errors: string[]
} {
  const printed: string[] = []
  const errors: string[] = []
  const api: GameCommandAPI = {
    moveTo: vi.fn(() => true),
    stop: vi.fn(),
    jump: vi.fn(() => true),
    performAction: vi.fn(),
    playEmote: vi.fn(async () => {}),
    setCameraFollow: vi.fn(),
    snapCamera: vi.fn(),
    setZoom: vi.fn(),
    getPosition: vi.fn(() => ({ x: 0, z: 0, yaw: 0 })),
    getCursorTarget: vi.fn(() => null),
    setName: vi.fn(),
    sendChat: vi.fn(),
    setHudEditMode: vi.fn(),
    resetHudLayout: vi.fn(),
    openSettings: vi.fn(),
    openPalette: vi.fn(),
    openPlayers: vi.fn(),
    openVoice: vi.fn(),
    setVoiceEnabled: vi.fn(async () => {}),
    setMicEnabled: vi.fn(async () => {}),
    setVoiceMode: vi.fn(),
    getVoiceMode: vi.fn(() => 'normal' as const),
    getWorlds: vi.fn(() => []),
    getCurrentWorld: vi.fn(() => null),
    switchWorld: vi.fn(async () => {}),
    interact: vi.fn(),
    focusChat: vi.fn(),
    openVrmPicker: vi.fn(),
    clearVrmCache: vi.fn(),
    getRenderStats: vi.fn(() => []),
    ...overrides,
  }
  const ctx: CommandContext = {
    api,
    out: {
      print: (text) => printed.push(text),
      error: (text) => errors.push(text),
    },
    depth: 0,
  }
  return { ctx, api, printed, errors }
}

/** メモリ上のStorage実装(localStorage代替) */
export function makeMemoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const map = new Map<string, string>()
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
  }
}
