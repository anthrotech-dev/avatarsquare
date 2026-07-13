import { describe, expect, it } from 'vitest'
import { DEFAULT_HOTBAR, HOTBAR_SIZE, loadHotbar, saveHotbar } from './hotbar'

function makeMemoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const map = new Map<string, string>()
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
  }
}

describe('hotbar', () => {
  it('初回はデフォルト構成を返す', () => {
    const slots = loadHotbar(makeMemoryStorage())
    expect(slots).toEqual(DEFAULT_HOTBAR)
    expect(slots).toHaveLength(HOTBAR_SIZE)
  })

  it('保存内容がラウンドトリップする', () => {
    const storage = makeMemoryStorage()
    const slots = loadHotbar(storage)
    slots[7] = { command: '/where', label: '座標' }
    slots[0] = null
    saveHotbar(slots, storage)
    expect(loadHotbar(storage)).toEqual(slots)
  })

  it('壊れたデータはデフォルトに戻る', () => {
    const storage = makeMemoryStorage()
    storage.setItem('avatarsquare:hotbar', '{bad')
    expect(loadHotbar(storage)).toEqual(DEFAULT_HOTBAR)
  })

  it('不正なスロットはnullとして読み込まれ、常にHOTBAR_SIZE個になる', () => {
    const storage = makeMemoryStorage()
    storage.setItem(
      'avatarsquare:hotbar',
      JSON.stringify([{ command: '/jump' }, { command: '/a', label: 'A' }]),
    )
    const slots = loadHotbar(storage)
    expect(slots).toHaveLength(HOTBAR_SIZE)
    expect(slots[0]).toBeNull()
    expect(slots[1]).toEqual({ command: '/a', label: 'A' })
  })
})
