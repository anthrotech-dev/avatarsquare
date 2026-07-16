import { describe, expect, it } from 'vitest'
import { SceneRenderer } from './SceneRenderer'
import { buildNavGrid, parseWorld } from './WorldDef'

// group(空コンテナ)のみのワールドはDOM/canvas不要でnode環境でも構築できる。
// ツリー解決・位置パッチ補間・動的spawn/despawnの純ロジックをここで固定する

function makeRenderer() {
  const world = parseWorld({
    id: 'test',
    size: 20,
    scene: [
      {
        id: 'entity',
        kind: 'group',
        x: 1,
        z: 2,
        targetable: true,
        children: [{ id: 'child', kind: 'group', x: 0.5, z: -0.5 }],
      },
    ],
  })
  return new SceneRenderer(world, 'http://localhost/worlds/test.json')
}

describe('SceneRenderer(ツリー・補間・動的ノード)', () => {
  it('worldPositionは親相対座標を合算する', () => {
    const r = makeRenderer()
    expect(r.worldPosition('entity')).toEqual({ x: 1, z: 2 })
    expect(r.worldPosition('child')).toEqual({ x: 1.5, z: 1.5 })
    expect(r.worldPosition('nope')).toBeNull()
  })

  it('findAncestorWithは属性を持つ最近傍祖先へ解決する', () => {
    const r = makeRenderer()
    expect(r.findAncestorWith('child', 'targetable')).toBe('entity')
    expect(r.findAncestorWith('entity', 'targetable')).toBe('entity')
    expect(r.findAncestorWith('child', 'interactable')).toBeNull()
  })

  it('位置パッチは補間され、update収束後に表示位置が一致する', () => {
    const r = makeRenderer()
    r.applyPatch('entity', { x: 5, z: 2 })
    // パッチ直後は権威座標(worldPosition)だけが動き、表示はまだ旧位置
    expect(r.worldPosition('entity')).toEqual({ x: 5, z: 2 })
    expect(r.viewWorldPosition('entity')?.x).toBeCloseTo(1)
    // 途中フレームで近づき…
    r.update(0.05) // t=0.6
    const mid = r.viewWorldPosition('entity')?.x ?? 0
    expect(mid).toBeGreaterThan(1)
    expect(mid).toBeLessThan(5)
    // 大きなdelta(t=1)で収束する
    r.update(1)
    expect(r.viewWorldPosition('entity')?.x).toBeCloseTo(5)
  })

  it('スナップショット(gsnap)経由の位置は即時反映される(再入室で滑らない)', () => {
    const r = makeRenderer()
    r.applySnapshot({ entity: { x: 9, z: 9 } })
    expect(r.viewWorldPosition('entity')).toEqual({ x: 9, z: 9 })
  })

  it('applySpawn/applyDespawnでツリーが増減し、補間対象も掃除される', () => {
    const r = makeRenderer()
    r.applySpawn(undefined, {
      id: 'slime',
      kind: 'group',
      x: 3,
      z: 3,
      targetable: true,
      children: [{ id: 'slime-visual', kind: 'group' }],
    })
    expect(r.worldPosition('slime')).toEqual({ x: 3, z: 3 })
    expect(r.findAncestorWith('slime-visual', 'targetable')).toBe('slime')
    r.applyPatch('slime', { x: 4 })
    r.applyDespawn('slime')
    expect(r.getNode('slime')).toBeUndefined()
    expect(r.getNode('slime-visual')).toBeUndefined()
    expect(r.viewWorldPosition('slime')).toBeNull()
    r.update(1) // despawn済みの補間対象が残っていれば例外や復活が起きる
  })

  it('id衝突するspawnは無視される', () => {
    const r = makeRenderer()
    r.applySpawn(undefined, { id: 'entity', kind: 'group', x: 9, z: 9 })
    expect(r.worldPosition('entity')).toEqual({ x: 1, z: 2 })
  })

  // 回帰: spawn後のnavGrid再構築はliveScene()を入力にするため、colliderノードが
  // ここから欠落すると既存の通行不可領域(海・噴水)が消えて水上を歩けてしまう
  it('liveSceneはcolliderノードを含み、spawn後の再構築でも通行不可が保たれる', () => {
    const world = parseWorld({
      id: 'test',
      size: 20,
      scene: [
        { id: 'pond', kind: 'collider', shape: 'circle', x: 5, z: 5, r: 2 },
        {
          id: 'terrain',
          kind: 'group',
          x: -4,
          z: -4,
          children: [
            {
              id: 'sea',
              kind: 'collider',
              shape: 'polygon',
              x: -1,
              z: -1,
              points: [
                [-2, -2],
                [2, -2],
                [2, 2],
                [-2, 2],
              ],
            },
          ],
        },
      ],
    })
    const r = new SceneRenderer(world, 'http://localhost/worlds/test.json')
    r.applySpawn(undefined, { id: 'slime', kind: 'group', x: 0, z: 0 })

    const live = r.liveScene()
    expect(live.find((n) => n.id === 'pond')).toMatchObject({ kind: 'collider', x: 5, z: 5 })
    // ネストされたcolliderはワールド座標に解決される(-4 + -1 = -5)
    expect(live.find((n) => n.id === 'sea')).toMatchObject({ kind: 'collider', x: -5, z: -5 })

    const grid = buildNavGrid({ ...world, scene: live })
    expect(grid.isWalkableAt(5, 5)).toBe(false) // circle collider内
    expect(grid.isWalkableAt(-5, -5)).toBe(false) // polygon collider内
    expect(grid.isWalkableAt(0, 0)).toBe(true) // スライム(collider属性なし)は塞がない
  })
})
