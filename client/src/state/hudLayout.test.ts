import { describe, expect, it } from 'vitest'
import {
  clampHudPosition,
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
  it('初回は空(全てデフォルト位置)', () => {
    expect(loadHudLayout(makeMemoryStorage())).toEqual({})
  })

  it('保存内容がラウンドトリップする(動的なホットバーIDも)', () => {
    const storage = makeMemoryStorage()
    const layout = {
      'hotbar-0': { x: 100, y: 200 },
      'hotbar-3': { x: 5, y: 6 },
      chat: { x: 10, y: 20 },
    }
    saveHudLayout(layout, storage)
    expect(loadHudLayout(storage)).toEqual(layout)
  })

  it('壊れたJSONは空に戻る', () => {
    const storage = makeMemoryStorage()
    storage.setItem('avatarsquare:hudLayout', '{bad')
    expect(loadHudLayout(storage)).toEqual({})
  })

  it('不正な値のキーは無視される', () => {
    const storage = makeMemoryStorage()
    storage.setItem(
      'avatarsquare:hudLayout',
      JSON.stringify({ 'hotbar-0': { x: 'a', y: 2 }, chat: { x: 5, y: 6 }, status: null }),
    )
    const layout = loadHudLayout(storage)
    expect(layout).toEqual({ chat: { x: 5, y: 6 } })
  })

  it('旧キーhotbarはhotbar-0に読み替える', () => {
    const storage = makeMemoryStorage()
    storage.setItem('avatarsquare:hudLayout', JSON.stringify({ hotbar: { x: 1, y: 2 } }))
    expect(loadHudLayout(storage)).toEqual({ 'hotbar-0': { x: 1, y: 2 } })
    // hotbar-0が既にあるなら旧キーは捨てる
    storage.setItem(
      'avatarsquare:hudLayout',
      JSON.stringify({ hotbar: { x: 1, y: 2 }, 'hotbar-0': { x: 3, y: 4 } }),
    )
    expect(loadHudLayout(storage)).toEqual({ 'hotbar-0': { x: 3, y: 4 } })
  })
})

describe('hudVisibility', () => {
  it('初回は空(全て表示扱い)', () => {
    expect(loadHudVisibility(makeMemoryStorage())).toEqual({})
  })

  it('保存内容がラウンドトリップする', () => {
    const storage = makeMemoryStorage()
    const visibility = { status: false, 'hotbar-1': false, chat: true }
    saveHudVisibility(visibility, storage)
    expect(loadHudVisibility(storage)).toEqual(visibility)
  })

  it('不正値のキーは無視される', () => {
    const storage = makeMemoryStorage()
    storage.setItem('avatarsquare:hudVisibility', JSON.stringify({ status: 'no', chat: false }))
    expect(loadHudVisibility(storage)).toEqual({ chat: false })
  })

  it('旧キーhotbarはhotbar-0に読み替える', () => {
    const storage = makeMemoryStorage()
    storage.setItem('avatarsquare:hudVisibility', JSON.stringify({ hotbar: false }))
    expect(loadHudVisibility(storage)).toEqual({ 'hotbar-0': false })
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
