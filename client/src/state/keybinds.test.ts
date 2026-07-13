import { describe, expect, it } from 'vitest'
import { HOTBAR_SIZE, swapSlots } from './hotbar'
import {
  DEFAULT_KEYBINDS,
  findKeybindConflicts,
  formatKeybind,
  loadKeybinds,
  matchKeybind,
  type SlotKeybind,
  saveKeybinds,
} from './keybinds'

function makeMemoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const map = new Map<string, string>()
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
  }
}

const bind = (code: string, mods: Partial<SlotKeybind> = {}): SlotKeybind => ({
  code,
  shift: false,
  ctrl: false,
  alt: false,
  ...mods,
})

describe('keybinds 永続化', () => {
  it('初回はDigit1..9,0のデフォルト', () => {
    const binds = loadKeybinds(makeMemoryStorage())
    expect(binds).toEqual(DEFAULT_KEYBINDS)
    expect(binds[0]?.code).toBe('Digit1')
    expect(binds[9]?.code).toBe('Digit0')
  })

  it('保存内容がラウンドトリップする', () => {
    const storage = makeMemoryStorage()
    const binds = loadKeybinds(storage)
    binds[0] = bind('KeyQ', { shift: true })
    binds[1] = null
    saveKeybinds(binds, storage)
    expect(loadKeybinds(storage)).toEqual(binds)
  })

  it('壊れたデータはデフォルトに戻る', () => {
    const storage = makeMemoryStorage()
    storage.setItem('avatarsquare:hotbarKeys', 'nope')
    expect(loadKeybinds(storage)).toEqual(DEFAULT_KEYBINDS)
  })

  it('不正要素はnullとして読み込まれ、常にHOTBAR_SIZE個', () => {
    const storage = makeMemoryStorage()
    storage.setItem('avatarsquare:hotbarKeys', JSON.stringify([{ code: 'KeyQ' }, bind('KeyW')]))
    const binds = loadKeybinds(storage)
    expect(binds).toHaveLength(HOTBAR_SIZE)
    expect(binds[0]).toBeNull()
    expect(binds[1]?.code).toBe('KeyW')
  })
})

describe('formatKeybind', () => {
  it('各種コードを短縮表示する', () => {
    expect(formatKeybind(bind('Digit1'))).toBe('1')
    expect(formatKeybind(bind('KeyQ', { shift: true }))).toBe('S+Q')
    expect(formatKeybind(bind('KeyX', { ctrl: true, alt: true }))).toBe('C+A+X')
    expect(formatKeybind(bind('F5'))).toBe('F5')
    expect(formatKeybind(bind('Numpad3'))).toBe('N3')
    expect(formatKeybind(null)).toBe('')
  })
})

describe('matchKeybind', () => {
  const ev = (code: string, mods: Partial<KeyboardEvent> = {}) => ({
    code,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    ...mods,
  })

  it('修飾キーは完全一致が必要', () => {
    const shiftQ = bind('KeyQ', { shift: true })
    expect(matchKeybind(shiftQ, ev('KeyQ', { shiftKey: true }))).toBe(true)
    expect(matchKeybind(shiftQ, ev('KeyQ'))).toBe(false)
    expect(matchKeybind(bind('KeyQ'), ev('KeyQ', { shiftKey: true }))).toBe(false)
    expect(matchKeybind(bind('KeyQ'), ev('KeyQ'))).toBe(true)
  })
})

describe('findKeybindConflicts', () => {
  it('予約キーは修飾なしのみ警告', () => {
    const binds = [...DEFAULT_KEYBINDS]
    expect(findKeybindConflicts(binds, 0, bind('Space')).reserved).toBe('ジャンプ')
    expect(findKeybindConflicts(binds, 0, bind('Space', { shift: true })).reserved).toBeNull()
  })

  it('他スロットとの重複を検出する(自分自身は除外)', () => {
    const binds = [...DEFAULT_KEYBINDS]
    expect(findKeybindConflicts(binds, 0, bind('Digit3')).slotIndex).toBe(2)
    expect(findKeybindConflicts(binds, 2, bind('Digit3')).slotIndex).toBeNull()
    expect(findKeybindConflicts(binds, 0, bind('KeyZ')).slotIndex).toBeNull()
  })
})

describe('swapSlots', () => {
  it('2スロットの中身を入れ替える', () => {
    const slots = [{ command: '/a', label: 'A' }, null, { command: '/c', label: 'C' }]
    const next = swapSlots(slots, 0, 1)
    expect(next[0]).toBeNull()
    expect(next[1]).toEqual({ command: '/a', label: 'A' })
    expect(next).not.toBe(slots)
  })

  it('範囲外indexは無視する', () => {
    const slots = [{ command: '/a', label: 'A' }]
    expect(swapSlots(slots, 0, 5)).toEqual(slots)
  })
})
