import { describe, expect, it } from 'vitest'
import {
  activateHotbar,
  DEFAULT_HOTBAR,
  deactivateHotbar,
  HOTBAR_SIZE,
  type HotbarData,
  loadHotbars,
  saveHotbars,
} from './hotbar'
import { DEFAULT_KEYBINDS } from './keybinds'

function makeMemoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const map = new Map<string, string>()
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
  }
}

const emptyBar = (seq: number, active = true): HotbarData => ({
  seq,
  active,
  slots: Array.from({ length: HOTBAR_SIZE }, () => null),
  keys: Array.from({ length: HOTBAR_SIZE }, () => null),
})

describe('loadHotbars', () => {
  it('初回はデフォルト構成のホットバー0を1本返す', () => {
    const hotbars = loadHotbars(makeMemoryStorage())
    expect(hotbars).toHaveLength(1)
    expect(hotbars[0].seq).toBe(0)
    expect(hotbars[0].active).toBe(true)
    expect(hotbars[0].slots).toEqual(DEFAULT_HOTBAR)
    expect(hotbars[0].slots).toHaveLength(HOTBAR_SIZE)
    expect(hotbars[0].keys).toEqual(DEFAULT_KEYBINDS)
  })

  it('保存内容(非アクティブ含む)がラウンドトリップする', () => {
    const storage = makeMemoryStorage()
    const hotbars = loadHotbars(storage)
    hotbars[0].slots[7] = { command: '/where', label: '座標' }
    hotbars.push({ ...emptyBar(1, false), slots: DEFAULT_HOTBAR.slice() })
    saveHotbars(hotbars, storage)
    expect(loadHotbars(storage)).toEqual(hotbars)
  })

  it('壊れたデータはデフォルトに戻る', () => {
    const storage = makeMemoryStorage()
    storage.setItem('avatarsquare:hotbars', '{bad')
    expect(loadHotbars(storage)).toEqual(loadHotbars(makeMemoryStorage()))
  })

  it('不正なスロット・キーはnullとして読み込まれ、常にHOTBAR_SIZE個になる', () => {
    const storage = makeMemoryStorage()
    storage.setItem(
      'avatarsquare:hotbars',
      JSON.stringify([
        {
          seq: 0,
          active: true,
          slots: [{ command: '/jump' }, { command: '/a', label: 'A' }],
          keys: [{ code: 'KeyQ' }],
        },
      ]),
    )
    const [hotbar] = loadHotbars(storage)
    expect(hotbar.slots).toHaveLength(HOTBAR_SIZE)
    expect(hotbar.keys).toHaveLength(HOTBAR_SIZE)
    expect(hotbar.slots[0]).toBeNull()
    expect(hotbar.slots[1]).toEqual({ command: '/a', label: 'A' })
    expect(hotbar.keys[0]).toBeNull()
  })

  it('旧形式(単一ホットバー)からマイグレーションする', () => {
    const storage = makeMemoryStorage()
    // 旧形式は10スロット
    const oldSlots = [
      { command: '/jump', label: 'ジャンプ' },
      null,
      { command: '/custom', label: 'カスタム' },
      ...Array.from({ length: 7 }, () => null),
    ]
    const oldKeys = [
      { code: 'KeyQ', shift: false, ctrl: false, alt: false },
      null,
      ...DEFAULT_KEYBINDS.slice(2, 10),
    ]
    storage.setItem('avatarsquare:hotbar', JSON.stringify(oldSlots))
    storage.setItem('avatarsquare:hotbarKeys', JSON.stringify(oldKeys))
    const hotbars = loadHotbars(storage)
    expect(hotbars).toHaveLength(1)
    expect(hotbars[0].seq).toBe(0)
    expect(hotbars[0].slots).toHaveLength(HOTBAR_SIZE)
    expect(hotbars[0].slots[0]).toEqual({ command: '/jump', label: 'ジャンプ' })
    expect(hotbars[0].slots[2]).toEqual({ command: '/custom', label: 'カスタム' })
    expect(hotbars[0].slots[10]).toBeNull()
    // ユーザー設定のキーとクリア(null)はそのまま、12スロット化で増えた分はデフォルトで補う
    expect(hotbars[0].keys[0]?.code).toBe('KeyQ')
    expect(hotbars[0].keys[1]).toBeNull()
    expect(hotbars[0].keys[10]).toEqual(DEFAULT_KEYBINDS[10])
    expect(hotbars[0].keys[11]).toEqual(DEFAULT_KEYBINDS[11])
  })
})

describe('activateHotbar / deactivateHotbar', () => {
  it('deactivateは設定を保持したままactive=falseにする', () => {
    const hotbars = loadHotbars(makeMemoryStorage())
    const next = deactivateHotbar(hotbars, 0)
    expect(next[0].active).toBe(false)
    expect(next[0].slots).toEqual(DEFAULT_HOTBAR)
    expect(next).not.toBe(hotbars)
  })

  it('activateは非アクティブの最小seqを設定ごと復活させる', () => {
    const hotbars = [emptyBar(0), { ...emptyBar(1, false) }, { ...emptyBar(2, false) }]
    hotbars[2].slots[0] = { command: '/a', label: 'A' }
    const next = activateHotbar(deactivateHotbar(hotbars, 2))
    // seq1が先に復活する
    expect(next.find((h) => h.seq === 1)?.active).toBe(true)
    expect(next.find((h) => h.seq === 2)?.active).toBe(false)
    // さらに追加でseq2が設定ごと復活
    const next2 = activateHotbar(next)
    expect(next2.find((h) => h.seq === 2)?.active).toBe(true)
    expect(next2.find((h) => h.seq === 2)?.slots[0]).toEqual({ command: '/a', label: 'A' })
  })

  it('全部activeならmax+1のseqで空のホットバーを新規作成する', () => {
    const next = activateHotbar([emptyBar(0), emptyBar(3)])
    expect(next).toHaveLength(3)
    const added = next[2]
    expect(added.seq).toBe(4)
    expect(added.active).toBe(true)
    expect(added.slots.every((s) => s === null)).toBe(true)
    expect(added.keys.every((k) => k === null)).toBe(true)
  })

  it('0本から追加してもseq採番できる', () => {
    const next = activateHotbar([])
    expect(next).toHaveLength(1)
    expect(next[0].seq).toBe(0)
  })
})
