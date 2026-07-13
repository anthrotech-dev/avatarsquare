import { describe, expect, it } from 'vitest'
import { HOTBAR_SIZE } from './hotbar'
import {
  DEFAULT_KEYBINDS,
  findKeybindConflicts,
  formatKeybind,
  matchKeybind,
  type SlotKeybind,
} from './keybinds'

const bind = (code: string, mods: Partial<SlotKeybind> = {}): SlotKeybind => ({
  code,
  shift: false,
  ctrl: false,
  alt: false,
  ...mods,
})

describe('DEFAULT_KEYBINDS', () => {
  it('12スロット分。1〜9,0,-,^の並び', () => {
    expect(DEFAULT_KEYBINDS).toHaveLength(HOTBAR_SIZE)
    expect(DEFAULT_KEYBINDS[0]?.code).toBe('Digit1')
    expect(DEFAULT_KEYBINDS[9]?.code).toBe('Digit0')
    expect(DEFAULT_KEYBINDS[10]?.code).toBe('Minus')
    expect(DEFAULT_KEYBINDS[11]?.code).toBe('Equal')
  })
})

describe('formatKeybind', () => {
  it('各種コードを短縮表示する', () => {
    expect(formatKeybind(bind('Digit1'))).toBe('1')
    expect(formatKeybind(bind('KeyQ', { shift: true }))).toBe('S+Q')
    expect(formatKeybind(bind('KeyX', { ctrl: true, alt: true }))).toBe('C+A+X')
    expect(formatKeybind(bind('F5'))).toBe('F5')
    expect(formatKeybind(bind('Numpad3'))).toBe('N3')
    expect(formatKeybind(bind('Minus'))).toBe('-')
    expect(formatKeybind(bind('Equal'))).toBe('^')
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
  const hotbars = [
    { seq: 0, keys: [...DEFAULT_KEYBINDS] },
    { seq: 2, keys: [bind('KeyQ'), null] },
  ]

  it('予約キーは修飾なしのみ警告', () => {
    expect(findKeybindConflicts(hotbars, { seq: 0, index: 0 }, bind('Space')).reserved).toBe(
      'ジャンプ',
    )
    expect(
      findKeybindConflicts(hotbars, { seq: 0, index: 0 }, bind('Space', { shift: true })).reserved,
    ).toBeNull()
  })

  it('同一ホットバー内の重複を検出する(自分自身は除外)', () => {
    expect(findKeybindConflicts(hotbars, { seq: 0, index: 0 }, bind('Digit3')).conflict).toEqual({
      seq: 0,
      index: 2,
    })
    expect(findKeybindConflicts(hotbars, { seq: 0, index: 2 }, bind('Digit3')).conflict).toBeNull()
    expect(findKeybindConflicts(hotbars, { seq: 0, index: 0 }, bind('KeyZ')).conflict).toBeNull()
  })

  it('別ホットバーとの重複も検出する', () => {
    expect(findKeybindConflicts(hotbars, { seq: 0, index: 0 }, bind('KeyQ')).conflict).toEqual({
      seq: 2,
      index: 0,
    })
    // 別ホットバーの同indexは自分自身ではない
    expect(findKeybindConflicts(hotbars, { seq: 2, index: 0 }, bind('Digit1')).conflict).toEqual({
      seq: 0,
      index: 0,
    })
  })
})
