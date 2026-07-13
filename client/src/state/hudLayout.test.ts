import { describe, expect, it } from 'vitest'
import {
  clampHudPosition,
  DEFAULT_HUD_LAYOUT,
  DEFAULT_HUD_VISIBILITY,
  loadHudLayout,
  loadHudVisibility,
  saveHudLayout,
  saveHudVisibility,
} from './hudLayout'

function makeMemoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const map = new Map<string, string>()
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
  }
}

describe('hudLayout', () => {
  it('初回は全てデフォルト位置(null)', () => {
    expect(loadHudLayout(makeMemoryStorage())).toEqual(DEFAULT_HUD_LAYOUT)
  })

  it('保存内容がラウンドトリップする', () => {
    const storage = makeMemoryStorage()
    const layout = loadHudLayout(storage)
    layout.hotbar = { x: 100, y: 200 }
    layout.chat = null
    saveHudLayout(layout, storage)
    expect(loadHudLayout(storage)).toEqual(layout)
  })

  it('壊れたJSONはデフォルトに戻る', () => {
    const storage = makeMemoryStorage()
    storage.setItem('avatarsquare:hudLayout', '{bad')
    expect(loadHudLayout(storage)).toEqual(DEFAULT_HUD_LAYOUT)
  })

  it('不正な値・未知のキーは無視される', () => {
    const storage = makeMemoryStorage()
    storage.setItem(
      'avatarsquare:hudLayout',
      JSON.stringify({ hotbar: { x: 'a', y: 2 }, chat: { x: 5, y: 6 }, unknown: { x: 1, y: 1 } }),
    )
    const layout = loadHudLayout(storage)
    expect(layout.hotbar).toBeNull()
    expect(layout.chat).toEqual({ x: 5, y: 6 })
    expect('unknown' in layout).toBe(false)
  })
})

describe('hudVisibility', () => {
  it('初回は全て表示', () => {
    expect(loadHudVisibility(makeMemoryStorage())).toEqual(DEFAULT_HUD_VISIBILITY)
  })

  it('保存内容がラウンドトリップする', () => {
    const storage = makeMemoryStorage()
    const visibility = loadHudVisibility(storage)
    visibility.settings = false
    saveHudVisibility(visibility, storage)
    expect(loadHudVisibility(storage)).toEqual(visibility)
  })

  it('壊れたデータ・不正値はデフォルトに戻る', () => {
    const storage = makeMemoryStorage()
    storage.setItem('avatarsquare:hudVisibility', JSON.stringify({ settings: 'no', chat: false }))
    const visibility = loadHudVisibility(storage)
    expect(visibility.settings).toBe(true)
    expect(visibility.chat).toBe(false)
  })
})

describe('clampHudPosition', () => {
  const viewport = { width: 1000, height: 800 }
  const size = { width: 300, height: 100 }

  it('画面内の位置はそのまま', () => {
    expect(clampHudPosition({ x: 100, y: 100 }, size, viewport)).toEqual({ x: 100, y: 100 })
  })

  it('負座標は掴める範囲に補正される', () => {
    const pos = clampHudPosition({ x: -1000, y: -50 }, size, viewport)
    expect(pos.x).toBeGreaterThanOrEqual(24 - size.width)
    expect(pos.y).toBe(0)
  })

  it('ビューポート超過は右下端に補正される', () => {
    const pos = clampHudPosition({ x: 5000, y: 5000 }, size, viewport)
    expect(pos.x).toBeLessThanOrEqual(viewport.width - 24)
    expect(pos.y).toBeLessThanOrEqual(viewport.height - 24)
  })

  it('要素がビューポートより大きくても掴める部分が残る', () => {
    const big = { width: 2000, height: 2000 }
    const pos = clampHudPosition({ x: -3000, y: 3000 }, big, viewport)
    expect(pos.x + big.width).toBeGreaterThanOrEqual(24)
    expect(pos.y).toBeLessThanOrEqual(viewport.height - 24)
  })
})
