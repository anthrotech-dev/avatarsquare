import { describe, expect, it } from 'vitest'
import { HOTBAR_SIZE } from './hotbar'
import {
  DEFAULT_KEYBINDS,
  findKeybindConflicts,
  formatKeybind,
  matchKeybind,
  mouseCode,
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
  it('12スロット分。1〜9,0,Space,Enterの並び', () => {
    expect(DEFAULT_KEYBINDS).toHaveLength(HOTBAR_SIZE)
    expect(DEFAULT_KEYBINDS[0]?.code).toBe('Digit1')
    expect(DEFAULT_KEYBINDS[9]?.code).toBe('Digit0')
    expect(DEFAULT_KEYBINDS[10]?.code).toBe('Space')
    expect(DEFAULT_KEYBINDS[11]?.code).toBe('Enter')
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

  it('マウスボタンの擬似codeを短縮表示する', () => {
    expect(formatKeybind(bind('Mouse1'))).toBe('中ク')
    expect(formatKeybind(bind('Mouse2'))).toBe('右ク')
    expect(formatKeybind(bind('Mouse3'))).toBe('M4')
    expect(formatKeybind(bind('Mouse4', { shift: true }))).toBe('S+M5')
  })
})

describe('mouseCode', () => {
  it('MouseEvent.buttonから擬似codeを作る', () => {
    expect(mouseCode(1)).toBe('Mouse1')
    expect(mouseCode(3)).toBe('Mouse3')
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

  it('右クリック(Mouse2)は修飾なしのみ予約警告', () => {
    expect(findKeybindConflicts(hotbars, { seq: 0, index: 0 }, bind('Mouse2')).reserved).toBe(
      '右クリック移動',
    )
    expect(
      findKeybindConflicts(hotbars, { seq: 0, index: 0 }, bind('Mouse2', { ctrl: true })).reserved,
    ).toBeNull()
    expect(findKeybindConflicts(hotbars, { seq: 0, index: 0 }, bind('Mouse3')).reserved).toBeNull()
  })

  it('予約キー(Escape)は修飾なしのみ警告', () => {
    expect(findKeybindConflicts(hotbars, { seq: 0, index: 0 }, bind('Escape')).reserved).toBe(
      'キャンセル操作',
    )
    expect(
      findKeybindConflicts(hotbars, { seq: 0, index: 0 }, bind('Escape', { shift: true })).reserved,
    ).toBeNull()
    // Space/Enterはホットバー割当なので予約扱いではなく重複として検出される
    expect(findKeybindConflicts(hotbars, { seq: 0, index: 0 }, bind('Space')).reserved).toBeNull()
    expect(findKeybindConflicts(hotbars, { seq: 0, index: 0 }, bind('Space')).conflict).toEqual({
      seq: 0,
      index: 10,
    })
    expect(findKeybindConflicts(hotbars, { seq: 0, index: 0 }, bind('Enter')).conflict).toEqual({
      seq: 0,
      index: 11,
    })
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
