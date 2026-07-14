import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerBuiltins } from './builtins'
import { CommandRegistry } from './CommandRegistry'
import { resetCooldowns } from './cooldowns'
import { MacroStore, wireMacros } from './macros'
import { makeMemoryStorage, makeTestContext } from './testUtils'

function makeSetup() {
  const store = new MacroStore(makeMemoryStorage())
  const registry = new CommandRegistry()
  registerBuiltins(registry, store)
  wireMacros(registry, store)
  return { store, registry }
}

describe('MacroStore', () => {
  it('保存・取得・削除がラウンドトリップする', () => {
    const store = new MacroStore(makeMemoryStorage())
    store.save({ name: 'dance', lines: ['/emote VRMA_05', '/jump'] })
    store.save({ name: 'greet', lines: ['/emote VRMA_02'] })
    expect(
      store
        .list()
        .map((m) => m.name)
        .sort(),
    ).toEqual(['dance', 'greet'])
    expect(store.get('DANCE')?.lines).toEqual(['/emote VRMA_05', '/jump'])
    store.remove('dance')
    expect(store.get('dance')).toBeUndefined()
  })

  it('同名保存は上書きになる', () => {
    const store = new MacroStore(makeMemoryStorage())
    store.save({ name: 'a', lines: ['/jump'] })
    store.save({ name: 'A', lines: ['/stop'] })
    expect(store.list()).toHaveLength(1)
    expect(store.get('a')?.lines).toEqual(['/stop'])
  })

  it('壊れたストレージ内容は空扱い', () => {
    const storage = makeMemoryStorage()
    storage.setItem('avatarsquare:macros', '{bad json')
    expect(new MacroStore(storage).list()).toEqual([])
  })

  it('保存・削除でonChangeが呼ばれる', () => {
    const store = new MacroStore(makeMemoryStorage())
    const onChange = vi.fn()
    store.onChange = onChange
    store.save({ name: 'a', lines: [] })
    store.remove('a')
    expect(onChange).toHaveBeenCalledTimes(2)
  })
})

describe('マクロの実行', () => {
  // /attackのCD状態はモジュールグローバルなので、テスト間で持ち越さない
  beforeEach(() => {
    vi.useFakeTimers()
    resetCooldowns()
  })
  afterEach(() => vi.useRealTimers())

  it('行を順番に実行する', async () => {
    const { store, registry } = makeSetup()
    const order: string[] = []
    store.save({ name: 'combo', lines: ['/jump', '', '/attack'] })
    const { ctx } = makeTestContext({
      jump: () => {
        order.push('jump')
        return true
      },
      performAction: (name) => order.push(name),
    })
    await registry.execute('/macro combo', ctx)
    expect(order).toEqual(['jump', 'slash'])
  })

  it('マクロ名を直接コマンドとして呼べる(fallback)', async () => {
    const { store, registry } = makeSetup()
    store.save({ name: 'dance', lines: ['/emote VRMA_05'] })
    const { ctx, api } = makeTestContext()
    await registry.execute('/dance', ctx)
    expect(api.playEmote).toHaveBeenCalledWith('VRMA_05')
  })

  it('/wait を挟んだシーケンスが時間どおり進む', async () => {
    const { store, registry } = makeSetup()
    store.save({ name: 'slow', lines: ['/jump', '/wait 2', '/attack'] })
    const { ctx, api } = makeTestContext()
    const done = registry.execute('/slow', ctx)
    await vi.advanceTimersByTimeAsync(1000)
    expect(api.jump).toHaveBeenCalled()
    expect(api.performAction).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1100)
    await done
    expect(api.performAction).toHaveBeenCalledWith('slash')
  })

  it('自己再帰マクロはdepth制限で止まる', async () => {
    const { store, registry } = makeSetup()
    store.save({ name: 'loop', lines: ['/jump', '/loop'] })
    const { ctx, api, errors } = makeTestContext()
    await registry.execute('/loop', ctx)
    expect(errors.some((e) => e.includes('入れ子が深すぎます'))).toBe(true)
    expect(vi.mocked(api.jump).mock.calls.length).toBeLessThanOrEqual(8)
  })

  it('未定義マクロの/macroはエラー', async () => {
    const { registry } = makeSetup()
    const { ctx, errors } = makeTestContext()
    await registry.execute('/macro nope', ctx)
    expect(errors[0]).toContain('nope')
  })
})
