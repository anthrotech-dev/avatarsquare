import { describe, expect, it } from 'vitest'
import {
  clampHudPlacement,
  clampHudPosition,
  type HudAnchor,
  type HudPlacement,
  loadHudLayout,
  loadHudVisibility,
  placementToStyle,
  placementToTopLeft,
  saveHudLayout,
  saveHudVisibility,
  topLeftToPlacement,
} from './hudLayout'

function makeMemoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const map = new Map<string, string>()
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
  }
}

const TL: HudAnchor = { h: 'left', v: 'top' }

/** 9アンカーの全組み合わせ */
const ALL_ANCHORS: HudAnchor[] = (['left', 'center', 'right'] as const).flatMap((h) =>
  (['top', 'middle', 'bottom'] as const).map((v) => ({ h, v })),
)

describe('hudLayout', () => {
  it('初回は空(全てデフォルト位置)', () => {
    expect(loadHudLayout(makeMemoryStorage())).toEqual({})
  })

  it('保存内容がラウンドトリップする(動的なホットバーIDも)', () => {
    const storage = makeMemoryStorage()
    const layout = {
      'hotbar-0': { anchor: { h: 'center', v: 'bottom' }, x: 0, y: 16 } as HudPlacement,
      'hotbar-3': { anchor: TL, x: 5, y: 6 } as HudPlacement,
      chat: { anchor: { h: 'left', v: 'bottom' }, x: 10, y: 20 } as HudPlacement,
      vc: { anchor: { h: 'right', v: 'middle' }, x: 12, y: -30 } as HudPlacement,
    }
    saveHudLayout(layout, storage)
    expect(loadHudLayout(storage)).toEqual(layout)
  })

  it('旧形式(anchorなし)はtop-leftとして読み替える', () => {
    const storage = makeMemoryStorage()
    storage.setItem(
      'avatarsquare:hudLayout',
      JSON.stringify({ chat: { x: 10, y: 20 }, vc: { x: 700, y: 12 } }),
    )
    expect(loadHudLayout(storage)).toEqual({
      chat: { anchor: TL, x: 10, y: 20 },
      vc: { anchor: TL, x: 700, y: 12 },
    })
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
      JSON.stringify({
        'hotbar-0': { x: 'a', y: 2 },
        chat: { x: 5, y: 6 },
        status: null,
        // 不正なanchor(3値外・文字列)はキーごと捨てる
        vc: { anchor: { h: 'weird', v: 'top' }, x: 1, y: 2 },
        target: { anchor: 'tl', x: 1, y: 2 },
      }),
    )
    const layout = loadHudLayout(storage)
    expect(layout).toEqual({ chat: { anchor: TL, x: 5, y: 6 } })
  })

  it('旧キーhotbarはhotbar-0に読み替える(旧形式の値でも)', () => {
    const storage = makeMemoryStorage()
    storage.setItem('avatarsquare:hudLayout', JSON.stringify({ hotbar: { x: 1, y: 2 } }))
    expect(loadHudLayout(storage)).toEqual({ 'hotbar-0': { anchor: TL, x: 1, y: 2 } })
    // hotbar-0が既にあるなら旧キーは捨てる
    storage.setItem(
      'avatarsquare:hudLayout',
      JSON.stringify({ hotbar: { x: 1, y: 2 }, 'hotbar-0': { x: 3, y: 4 } }),
    )
    expect(loadHudLayout(storage)).toEqual({ 'hotbar-0': { anchor: TL, x: 3, y: 4 } })
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

describe('placementToTopLeft / topLeftToPlacement', () => {
  const viewport = { width: 1000, height: 800 }
  const size = { width: 300, height: 100 }

  it('9アンカーそれぞれのleft/top換算', () => {
    const cases: Array<[HudAnchor, { x: number; y: number }]> = [
      [
        { h: 'left', v: 'top' },
        { x: 12, y: 12 },
      ],
      [
        { h: 'right', v: 'top' },
        { x: 1000 - 12 - 300, y: 12 },
      ],
      [
        { h: 'left', v: 'bottom' },
        { x: 12, y: 800 - 12 - 100 },
      ],
      [
        { h: 'right', v: 'bottom' },
        { x: 688, y: 688 },
      ],
      [
        { h: 'center', v: 'top' },
        { x: 500 + 12 - 150, y: 12 },
      ],
      [
        { h: 'left', v: 'middle' },
        { x: 12, y: 400 + 12 - 50 },
      ],
      [
        { h: 'center', v: 'middle' },
        { x: 362, y: 362 },
      ],
      [
        { h: 'right', v: 'middle' },
        { x: 688, y: 362 },
      ],
      [
        { h: 'center', v: 'bottom' },
        { x: 362, y: 688 },
      ],
    ]
    for (const [anchor, expected] of cases) {
      expect(placementToTopLeft({ anchor, x: 12, y: 12 }, size, viewport)).toEqual(expected)
    }
  })

  it('center/middleのオフセット0はビューポート中心に要素中心が重なる', () => {
    const pos = placementToTopLeft(
      { anchor: { h: 'center', v: 'middle' }, x: 0, y: 0 },
      size,
      viewport,
    )
    expect(pos).toEqual({ x: 350, y: 350 })
  })

  it('9アンカー全てで往復が恒等になる', () => {
    for (const anchor of ALL_ANCHORS) {
      const p: HudPlacement = { anchor, x: 37, y: -13 }
      const roundTripped = topLeftToPlacement(
        placementToTopLeft(p, size, viewport),
        anchor,
        size,
        viewport,
      )
      expect(roundTripped).toEqual(p)
    }
  })
})

describe('clampHudPlacement', () => {
  const viewport = { width: 1000, height: 800 }
  const size = { width: 300, height: 100 }

  it('画面内はアンカーを保ったままそのまま', () => {
    const p: HudPlacement = { anchor: { h: 'right', v: 'bottom' }, x: 12, y: 12 }
    expect(clampHudPlacement(p, size, viewport)).toEqual(p)
  })

  it('rightアンカーの過大なオフセットは掴める範囲に補正される', () => {
    const p: HudPlacement = { anchor: { h: 'right', v: 'top' }, x: 5000, y: 12 }
    const clamped = clampHudPlacement(p, size, viewport)
    expect(clamped.anchor).toEqual(p.anchor)
    const pos = placementToTopLeft(clamped, size, viewport)
    expect(pos.x + size.width).toBeGreaterThanOrEqual(24)
  })

  it('bottomアンカーでも上方向には見切れない(minY=0)', () => {
    const p: HudPlacement = { anchor: { h: 'left', v: 'bottom' }, x: 12, y: 5000 }
    const clamped = clampHudPlacement(p, size, viewport)
    const pos = placementToTopLeft(clamped, size, viewport)
    expect(pos.y).toBe(0)
  })

  it('centerアンカーのはみ出しも補正される', () => {
    const p: HudPlacement = { anchor: { h: 'center', v: 'top' }, x: 5000, y: 12 }
    const clamped = clampHudPlacement(p, size, viewport)
    const pos = placementToTopLeft(clamped, size, viewport)
    expect(pos.x).toBeLessThanOrEqual(viewport.width - 24)
  })
})

describe('placementToStyle', () => {
  it('top-leftはleft/top直指定でtransformなし', () => {
    expect(placementToStyle({ anchor: { h: 'left', v: 'top' }, x: 10, y: 20 })).toEqual({
      left: 10,
      right: 'auto',
      top: 20,
      bottom: 'auto',
      transform: 'none',
    })
  })

  it('bottom-rightはright/bottom指定(ブラウザがリサイズ追従する)', () => {
    expect(placementToStyle({ anchor: { h: 'right', v: 'bottom' }, x: 10, y: 20 })).toEqual({
      left: 'auto',
      right: 10,
      top: 'auto',
      bottom: 20,
      transform: 'none',
    })
  })

  it('top-centerはcalc+translateX', () => {
    expect(placementToStyle({ anchor: { h: 'center', v: 'top' }, x: 30, y: 12 })).toEqual({
      left: 'calc(50% + 30px)',
      right: 'auto',
      top: 12,
      bottom: 'auto',
      transform: 'translate(-50%, 0px)',
    })
  })

  it('middle-centerは両軸translate', () => {
    const style = placementToStyle({ anchor: { h: 'center', v: 'middle' }, x: 0, y: 0 })
    expect(style.left).toBe('calc(50% + 0px)')
    expect(style.top).toBe('calc(50% + 0px)')
    expect(style.transform).toBe('translate(-50%, -50%)')
  })

  it('負オフセットもcalcに乗る', () => {
    const style = placementToStyle({ anchor: { h: 'center', v: 'top' }, x: -30, y: 12 })
    expect(style.left).toBe('calc(50% + -30px)')
  })
})
