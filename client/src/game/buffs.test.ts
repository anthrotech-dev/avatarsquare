import { describe, expect, it } from 'vitest'
import { normalizeBuffs } from './buffs'

describe('normalizeBuffs(ノード属性buffsの正規化)', () => {
  it('remainingMsを受信時刻起点のexpiresAtに変換する', () => {
    const buffs = normalizeBuffs(
      [{ id: 'stagger', name: 'よろめき', kind: 'debuff', remainingMs: 5000, durationMs: 5000 }],
      1000,
    )
    expect(buffs).toEqual([
      { id: 'stagger', name: 'よろめき', kind: 'debuff', expiresAt: 6000, durationMs: 5000 },
    ])
  })

  it('remainingMs省略は永続バフ(expiresAt=null)になる', () => {
    const buffs = normalizeBuffs([{ id: 'aura', name: 'オーラ', kind: 'buff' }], 1000)
    expect(buffs).toEqual([
      { id: 'aura', name: 'オーラ', kind: 'buff', expiresAt: null, durationMs: null },
    ])
  })

  it('durationMs省略時はremainingMsを全長として代用する', () => {
    const buffs = normalizeBuffs(
      [{ id: 'slow', name: 'スロウ', kind: 'debuff', remainingMs: 3000 }],
      0,
    )
    expect(buffs[0].durationMs).toBe(3000)
  })

  it('id/name欠落・kind不正の要素はスキップする', () => {
    const buffs = normalizeBuffs(
      [
        { name: '名無し', kind: 'buff' },
        { id: 'x', kind: 'buff' },
        { id: 'y', name: 'Y', kind: 'poison' },
        'not-an-object',
        null,
        { id: 'ok', name: 'OK', kind: 'buff' },
      ],
      0,
    )
    expect(buffs.map((b) => b.id)).toEqual(['ok'])
  })

  it('配列でない値は空配列になる', () => {
    expect(normalizeBuffs(undefined, 0)).toEqual([])
    expect(normalizeBuffs({ id: 'x' }, 0)).toEqual([])
    expect(normalizeBuffs('buffs', 0)).toEqual([])
  })
})
