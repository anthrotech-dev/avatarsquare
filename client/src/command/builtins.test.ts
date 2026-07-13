import { describe, expect, it, vi } from 'vitest'
import { CommandRegistry } from './CommandRegistry'
import { registerBuiltins } from './builtins'
import { MacroStore } from './macros'
import { makeMemoryStorage, makeTestContext } from './testUtils'

function makeRegistry(): CommandRegistry {
  const registry = new CommandRegistry()
  registerBuiltins(registry, new MacroStore(makeMemoryStorage()))
  return registry
}

describe('/shoot(方向指定・射程一定)', () => {
  it('カーソル位置は方向の指定で、着弾は射程6mに正規化される', async () => {
    const registry = makeRegistry()
    // 近いカーソル(1.8m右)でも遠いカーソル(60m右)でも同じ着弾点
    for (const cursorX of [1.8, 60]) {
      const { ctx, api } = makeTestContext({
        getCursorTarget: vi.fn(() => ({ x: cursorX, z: 0 })),
      })
      await registry.execute('/shoot', ctx)
      expect(api.performAction).toHaveBeenCalledWith('shoot', { x: 6, z: 0 })
    }
  })

  it('座標引数も方向の指定として射程6mに正規化される', async () => {
    const { ctx, api } = makeTestContext()
    await makeRegistry().execute('/shoot 0 100', ctx)
    expect(api.performAction).toHaveBeenCalledWith('shoot', { x: 0, z: 6 })
  })

  it('カーソルが取れないときは向いている方向へ6m', async () => {
    const { ctx, api } = makeTestContext({
      getCursorTarget: vi.fn(() => null),
      getPosition: vi.fn(() => ({ x: 1, z: 2, yaw: Math.PI / 2 })), // +X向き
    })
    await makeRegistry().execute('/shoot', ctx)
    const [, target] = (api.performAction as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(target.x).toBeCloseTo(7)
    expect(target.z).toBeCloseTo(2)
  })

  it('狙い先が自分と同一地点なら向いている方向へ6m', async () => {
    const { ctx, api } = makeTestContext({
      getCursorTarget: vi.fn(() => ({ x: 0, z: 0 })), // 自分の足元
    })
    await makeRegistry().execute('/shoot', ctx)
    const [, target] = (api.performAction as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(target.x).toBeCloseTo(0) // yaw=0は+Z向き
    expect(target.z).toBeCloseTo(6)
  })
})
