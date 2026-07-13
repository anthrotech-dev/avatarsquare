import { describe, expect, it } from 'vitest'
import { buildNavGrid, SPAWN } from './MapDef'
import { NavGrid } from './pathfinding'

function makeGrid(block?: (x: number, z: number) => boolean): NavGrid {
  const grid = new NavGrid(20, 0.5)
  grid.blockWhere((x, z) => Math.max(Math.abs(x), Math.abs(z)) > 9 || (block?.(x, z) ?? false))
  return grid
}

describe('NavGrid.findPath', () => {
  it('障害物がなければ直線(1区間)になる', () => {
    const grid = makeGrid()
    const path = grid.findPath({ x: -3, z: -3 }, { x: 3, z: 3 })
    expect(path).not.toBeNull()
    expect(path).toHaveLength(1)
    expect(path?.[0].x).toBeCloseTo(3)
    expect(path?.[0].z).toBeCloseTo(3)
  })

  it('壁があれば迂回する', () => {
    // x=-5..5 に横壁
    const grid = makeGrid((x, z) => Math.abs(x) <= 5 && Math.abs(z) <= 0.5)
    const path = grid.findPath({ x: 0, z: -5 }, { x: 0, z: 5 })
    expect(path).not.toBeNull()
    expect(path?.length).toBeGreaterThan(1)
    // 壁の端(|x|>5)を回り込んでいること
    const maxX = Math.max(...(path ?? []).map((p) => Math.abs(p.x)))
    expect(maxX).toBeGreaterThan(4.5)
    // 終点は目的地
    const last = path?.[path.length - 1]
    expect(last?.x).toBeCloseTo(0)
    expect(last?.z).toBeCloseTo(5)
  })

  it('通行不可の地点を指定すると最寄りの通行可能地点まで移動する', () => {
    const grid = makeGrid((x, z) => Math.hypot(x - 5, z - 5) < 2)
    const path = grid.findPath({ x: 0, z: 0 }, { x: 5, z: 5 })
    expect(path).not.toBeNull()
    const last = path?.[path.length - 1]
    if (!last) throw new Error('empty path')
    // 目的地は円の外に調整される
    expect(Math.hypot(last.x - 5, last.z - 5)).toBeGreaterThanOrEqual(1.5)
  })

  it('到達不能ならnullを返す', () => {
    // 目的地を完全に囲む
    const grid = makeGrid((x, z) => {
      const dist = Math.hypot(x - 5, z - 5)
      return dist > 1.5 && dist < 3.5
    })
    const path = grid.findPath({ x: -5, z: -5 }, { x: 5, z: 5 })
    expect(path).toBeNull()
  })

  it('実マップのグリッドでスポーン地点から各所へ到達できる', () => {
    const grid = buildNavGrid()
    expect(grid.isWalkableAt(SPAWN.x, SPAWN.z)).toBe(true)
    for (const goal of [
      { x: -25, z: -25 }, // 森の奥
      { x: 25, z: 25 }, // 海(最寄りの砂浜に調整される)
      { x: -25, z: 25 }, // 草原の隅
      { x: 14, z: -10 }, // 砂浜
    ]) {
      expect(grid.findPath(SPAWN, goal)).not.toBeNull()
    }
  })
})
