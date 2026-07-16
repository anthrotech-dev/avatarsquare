import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildNavGrid, getObstacles, hitsObstacle, parseWorld } from './WorldDef'

function loadSquareWorld() {
  const url = new URL('../../public/worlds/square.json', import.meta.url)
  return parseWorld(JSON.parse(readFileSync(url, 'utf-8')))
}

describe('parseWorld', () => {
  it('最小構成のワールドを受け付ける', () => {
    const world = parseWorld({ id: 'test', size: 20, scene: [] })
    expect(world.id).toBe('test')
    expect(world.name).toBe('test') // 名前未指定はidで代用
    expect(world.spawn).toEqual({ x: 0, z: 0 })
    expect(world.scripts).toEqual([])
  })

  it('不正なid・size・sceneは弾く', () => {
    expect(() => parseWorld({ id: 'bad id!', size: 20, scene: [] })).toThrow()
    expect(() => parseWorld({ id: 'test', size: 0, scene: [] })).toThrow()
    expect(() => parseWorld({ id: 'test', size: 20 })).toThrow()
    expect(() => parseWorld(null)).toThrow()
  })

  it('id重複・id/kind欠落のノードはスキップする(前方互換)', () => {
    const world = parseWorld({
      id: 'test',
      size: 20,
      scene: [
        { id: 'a', kind: 'sprite' },
        { id: 'a', kind: 'sprite' }, // 重複
        { kind: 'sprite' }, // id欠落
        { id: 'b' }, // kind欠落
        { id: 'c', kind: 'unknown-kind', someAttr: 1 }, // 未知kindは保持(描画側が無視)
      ],
    })
    expect(world.scene.map((n) => n.id)).toEqual(['a', 'c'])
    expect(world.scene[1].someAttr).toBe(1)
  })

  it('childrenをネストのまま保持し、idの一意性はツリー全体で見る', () => {
    const world = parseWorld({
      id: 'test',
      size: 20,
      scene: [
        {
          id: 'entity',
          kind: 'group',
          children: [
            { id: 'visual', kind: 'sprite' },
            { id: 'entity', kind: 'sprite' }, // ツリー内の重複はスキップ
            { kind: 'sprite' }, // id欠落もスキップ
          ],
        },
        { id: 'visual', kind: 'sprite' }, // 子と重複するトップレベルもスキップ
      ],
    })
    expect(world.scene.map((n) => n.id)).toEqual(['entity'])
    expect(world.scene[0].children?.map((n) => n.id)).toEqual(['visual'])
  })
})

describe('getObstacles / hitsObstacle', () => {
  const world = parseWorld({
    id: 'test',
    size: 20,
    scene: [
      { id: 'c1', kind: 'collider', shape: 'circle', x: 0, z: 0, r: 2 },
      { id: 'r1', kind: 'collider', shape: 'rect', x: 5, z: 5, w: 2, d: 4 },
      {
        id: 'p1',
        kind: 'collider',
        shape: 'polygon',
        points: [
          [8, -8],
          [9, 8],
          [12, 8],
          [12, -8],
        ],
      },
      { id: 's1', kind: 'sprite', x: -5, z: -5, collider: 0.5 },
      { id: 's2', kind: 'sprite', x: -8, z: -8 }, // collider無し=通行可能な飾り
    ],
  })

  it('collider形状とcollider属性から障害物を導出する', () => {
    const obstacles = getObstacles(world)
    expect(obstacles).toHaveLength(4) // circle + rect + polygon + sprite足元円
    expect(hitsObstacle(0, 0, obstacles)).toBe(true) // 円の中心
    expect(hitsObstacle(0, 2.5, obstacles)).toBe(false) // 円の外
    expect(hitsObstacle(5, 6.5, obstacles)).toBe(true) // 矩形の中
    expect(hitsObstacle(5, 7.5, obstacles)).toBe(false) // 矩形の外
    expect(hitsObstacle(10, 0, obstacles)).toBe(true) // ポリゴンの中
    expect(hitsObstacle(7, 0, obstacles)).toBe(false) // ポリゴンの外
    expect(hitsObstacle(-5, -5, obstacles)).toBe(true) // スプライトの足元
    expect(hitsObstacle(-8, -8, obstacles)).toBe(false) // collider無しスプライト
  })

  it('marginで障害物が膨らむ(ポリゴンは辺からの距離)', () => {
    const obstacles = getObstacles(world, 0.5)
    expect(hitsObstacle(0, 2.3, obstacles)).toBe(true) // 円: r2+0.5
    expect(hitsObstacle(8.6, 0, obstacles)).toBe(true) // ポリゴン辺の外側0.5以内
  })

  it('子ノードの障害物は親相対座標をワールド座標に合算する', () => {
    const nested = parseWorld({
      id: 'test',
      size: 20,
      scene: [
        {
          id: 'entity',
          kind: 'group',
          x: 5,
          z: -3,
          collider: 0.5,
          children: [{ id: 'child-col', kind: 'collider', shape: 'circle', x: 2, z: 1, r: 1 }],
        },
      ],
    })
    const obstacles = getObstacles(nested)
    expect(hitsObstacle(5, -3, obstacles)).toBe(true) // 親自身の足元円
    expect(hitsObstacle(7, -2, obstacles)).toBe(true) // 子circle: (5+2, -3+1)
    expect(hitsObstacle(2, 1, obstacles)).toBe(false) // 子のローカル座標そのままの位置には無い
  })
})

describe('islandワールド(生成物)', () => {
  const url = new URL('../../public/worlds/island.json', import.meta.url)
  const world = parseWorld(JSON.parse(readFileSync(url, 'utf-8')))
  const grid = buildNavGrid(world)

  it('海はキーホールポリゴン1つで表現され、島の中だけ歩ける', () => {
    expect(grid.isWalkableAt(world.spawn.x, world.spawn.z)).toBe(true) // 島中央(スポーン)
    expect(grid.isWalkableAt(8, 0)).toBe(true) // 島の砂地
    expect(grid.isWalkableAt(25, 25)).toBe(false) // 沖(ポリゴンの中=海)
    expect(grid.isWalkableAt(-25, 0)).toBe(false) // 西の沖
    expect(grid.isWalkableAt(0, -25)).toBe(false) // 北の沖
  })

  it('ポータルで行き来できる構成になっている(両ワールドにportal属性ノード)', () => {
    const portal = world.scene.find((n) => n.portal !== undefined)
    expect(portal?.portal).toBe('square')
    expect(portal?.interactable).toBe(true)
  })
})

describe('squareワールド(生成物)', () => {
  const world = loadSquareWorld()
  const grid = buildNavGrid(world)

  it('スキーマが期待どおり', () => {
    expect(world.id).toBe('square')
    expect(world.size).toBe(60)
    expect(world.scene.some((n) => n.kind === 'ground')).toBe(true)
  })

  it('通行判定が旧MapDefと同じ振る舞いをする', () => {
    expect(grid.isWalkableAt(world.spawn.x, world.spawn.z)).toBe(true) // スポーン
    expect(grid.isWalkableAt(0, 0)).toBe(false) // 噴水
    expect(grid.isWalkableAt(25, 0)).toBe(false) // 海(coastX(0)=17より東)
    expect(grid.isWalkableAt(15, 0)).toBe(true) // 砂浜
    expect(grid.isWalkableAt(-22, -16)).toBe(false) // 木(tree-1)
    expect(grid.isWalkableAt(-29.8, 0)).toBe(false) // マップ外周
  })

  it('島へのポータルがある', () => {
    const portal = world.scene.find((n) => n.portal !== undefined)
    expect(portal?.portal).toBe('island')
    expect(portal?.interactable).toBe(true)
  })
})
