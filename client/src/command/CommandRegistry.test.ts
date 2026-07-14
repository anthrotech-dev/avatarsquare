import { beforeEach, describe, expect, it, vi } from 'vitest'
import { registerBuiltins } from './builtins'
import { CommandRegistry } from './CommandRegistry'
import { resetCooldowns } from './cooldowns'
import { MacroStore } from './macros'
import { makeMemoryStorage, makeTestContext } from './testUtils'

function makeRegistry(): CommandRegistry {
  const registry = new CommandRegistry()
  registerBuiltins(registry, new MacroStore(makeMemoryStorage()))
  return registry
}

describe('CommandRegistry', () => {
  // attack/shootのCD状態はモジュールグローバルなので、テスト間で持ち越さない
  beforeEach(() => {
    resetCooldowns()
  })

  it('登録したコマンドを実行できる', async () => {
    const registry = makeRegistry()
    const { ctx, api } = makeTestContext()
    await registry.execute('/move 3 -2', ctx)
    expect(api.moveTo).toHaveBeenCalledWith(3, -2)
  })

  it('aliasで解決できる', async () => {
    const registry = makeRegistry()
    const { ctx, api } = makeTestContext()
    await registry.execute('/slash', ctx)
    expect(api.performAction).toHaveBeenCalledWith('slash')
    await registry.execute('/e VRMA_02', ctx)
    expect(api.playEmote).toHaveBeenCalledWith('VRMA_02')
  })

  it('大文字小文字を区別しない', async () => {
    const registry = makeRegistry()
    const { ctx, api } = makeTestContext()
    await registry.execute('/JUMP', ctx)
    expect(api.jump).toHaveBeenCalled()
  })

  it('未知のコマンドはエラー出力になる', async () => {
    const registry = makeRegistry()
    const { ctx, errors } = makeTestContext()
    await registry.execute('/nope', ctx)
    expect(errors).toEqual(['未知のコマンド: /nope'])
  })

  it('コマンドでない行は無視される', async () => {
    const registry = makeRegistry()
    const { ctx, errors, printed } = makeTestContext()
    await registry.execute('hello', ctx)
    expect(errors).toEqual([])
    expect(printed).toEqual([])
  })

  it('実行中のthrowはerrorに変換される', async () => {
    const registry = makeRegistry()
    registry.register({
      name: 'boom',
      description: 'test',
      execute() {
        throw new Error('bang')
      },
    })
    const { ctx, errors } = makeTestContext()
    await registry.execute('/boom', ctx)
    expect(errors).toEqual(['/boom 失敗: bang'])
  })

  it('fallbackで動的に解決できる', async () => {
    const registry = makeRegistry()
    const dynamic = vi.fn()
    registry.setFallback((name) =>
      name === 'dyn' ? { name: 'dyn', description: 'test', execute: dynamic } : undefined,
    )
    const { ctx } = makeTestContext()
    await registry.execute('/dyn', ctx)
    expect(dynamic).toHaveBeenCalled()
  })

  it('引数不足はエラーメッセージになる', async () => {
    const registry = makeRegistry()
    const { ctx, errors, api } = makeTestContext()
    await registry.execute('/move 3', ctx)
    expect(api.moveTo).not.toHaveBeenCalled()
    expect(errors[0]).toContain('/move')
  })

  it('/shoot 省略時は前方を対象にする', async () => {
    const registry = makeRegistry()
    const { ctx, api } = makeTestContext({
      getPosition: () => ({ x: 1, z: 2, yaw: Math.PI / 2 }), // +X向き
    })
    await registry.execute('/shoot', ctx)
    const call = vi.mocked(api.performAction).mock.calls[0]
    expect(call[0]).toBe('shoot')
    expect(call[1]?.x).toBeCloseTo(7)
    expect(call[1]?.z).toBeCloseTo(2)
  })

  it('/say はチャットを送信する', async () => {
    const registry = makeRegistry()
    const { ctx, api } = makeTestContext()
    await registry.execute('/say hello world', ctx)
    expect(api.sendChat).toHaveBeenCalledWith('hello world')
  })

  it('/say は連続スペース・引用符を改変せず送る', async () => {
    const registry = makeRegistry()
    const { ctx, api } = makeTestContext()
    await registry.execute('/say "こんにちは"  と言った', ctx)
    expect(api.sendChat).toHaveBeenCalledWith('"こんにちは"  と言った')
  })

  it('/say 引数なしはエラーメッセージになる', async () => {
    const registry = makeRegistry()
    const { ctx, errors, api } = makeTestContext()
    await registry.execute('/say', ctx)
    expect(api.sendChat).not.toHaveBeenCalled()
    expect(errors[0]).toContain('/say')
  })

  it('クールダウン中の再実行は無視される', async () => {
    vi.useFakeTimers({ toFake: ['performance'] })
    try {
      const registry = makeRegistry()
      const { ctx, api, errors } = makeTestContext()
      await registry.execute('/attack', ctx)
      await registry.execute('/attack', ctx)
      expect(api.performAction).toHaveBeenCalledTimes(1)
      // 無視は黙って行う(エラー出力しない)
      expect(errors).toEqual([])
      vi.advanceTimersByTime(3000)
      await registry.execute('/attack', ctx)
      expect(api.performAction).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('クールダウンはaliasと共有される', async () => {
    const registry = makeRegistry()
    const { ctx, api } = makeTestContext()
    await registry.execute('/attack', ctx)
    await registry.execute('/slash', ctx)
    expect(api.performAction).toHaveBeenCalledTimes(1)
  })

  it('/help はコマンド一覧を出力する', async () => {
    const registry = makeRegistry()
    const { ctx, printed } = makeTestContext()
    await registry.execute('/help', ctx)
    expect(printed.some((line) => line.startsWith('/move'))).toBe(true)
    await registry.execute('/help move', ctx)
    expect(printed.at(-1)).toContain('/move <x> <z>')
  })
})
