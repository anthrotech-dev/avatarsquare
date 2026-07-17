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

// /shootのCD状態はモジュールグローバルなので、テスト間で持ち越さない
beforeEach(() => {
  resetCooldowns()
})

describe('/shoot(方向指定・射程一定)', () => {
  it('カーソル位置は方向の指定で、着弾は射程6mに正規化される', async () => {
    const registry = makeRegistry()
    // 近いカーソル(1.8m右)でも遠いカーソル(60m右)でも同じ着弾点
    for (const cursorX of [1.8, 60]) {
      resetCooldowns()
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

describe('/attack(対象指定スキル)と/target', () => {
  it('対象が未選択(取得できない)なら発動せずCDも消費しない', async () => {
    const registry = makeRegistry()
    const { ctx, api, errors } = makeTestContext({ acquireTarget: vi.fn(() => null) })
    await registry.execute('/attack', ctx)
    expect(api.performAction).not.toHaveBeenCalled()
    expect(errors[0]).toContain('対象を選択')
    // CD返金の確認: 対象が取れれば直後の再実行が通る
    const { ctx: ctx2, api: api2 } = makeTestContext({
      acquireTarget: vi.fn(() => ({ id: 'scarecrow', name: 'かかし', x: 0, z: 1, radius: 0.5 })),
    })
    await registry.execute('/attack', ctx2)
    expect(api2.performAction).toHaveBeenCalledTimes(1)
  })

  it('射程外(距離-半径 > 2.2m)なら発動せず自動接近を開始する(CDは返金)', async () => {
    const registry = makeRegistry()
    const { ctx, api, errors } = makeTestContext({
      acquireTarget: vi.fn(() => ({ id: 'scarecrow', name: 'かかし', x: 0, z: 3, radius: 0.5 })),
    })
    await registry.execute('/attack', ctx)
    expect(api.performAction).not.toHaveBeenCalled()
    expect(api.approachTarget).toHaveBeenCalledWith('scarecrow', 2.2, 0.5, '/attack')
    expect(errors).toHaveLength(0)
    // CD返金の確認: 射程内に入れば直後の再実行が通る
    const { ctx: ctx2, api: api2 } = makeTestContext({
      acquireTarget: vi.fn(() => ({ id: 'scarecrow', name: 'かかし', x: 0, z: 1, radius: 0.5 })),
    })
    await registry.execute('/attack', ctx2)
    expect(api2.performAction).toHaveBeenCalledTimes(1)
  })

  it('射程外かつ到達不能(接近開始失敗)ならエラーを表示する', async () => {
    const { ctx, api, errors } = makeTestContext({
      acquireTarget: vi.fn(() => ({ id: 'scarecrow', name: 'かかし', x: 0, z: 3, radius: 0.5 })),
      approachTarget: vi.fn(() => false),
    })
    await makeRegistry().execute('/attack', ctx)
    expect(api.performAction).not.toHaveBeenCalled()
    expect(errors[0]).toContain('到達できません')
  })

  it('半径ぶんで射程に届けば発動し、対象座標とtidを渡す', async () => {
    const { ctx, api } = makeTestContext({
      acquireTarget: vi.fn(() => ({ id: 'scarecrow', name: 'かかし', x: 0, z: 2.5, radius: 0.5 })),
    })
    await makeRegistry().execute('/attack', ctx)
    expect(api.performAction).toHaveBeenCalledWith('slash', { x: 0, z: 2.5 }, 'scarecrow')
  })

  it('/target <id> は選択、/target clear は解除する', async () => {
    const registry = makeRegistry()
    const { ctx, api, errors } = makeTestContext()
    await registry.execute('/target scarecrow', ctx)
    expect(api.selectTarget).toHaveBeenCalledWith('scarecrow')
    await registry.execute('/target clear', ctx)
    expect(api.selectTarget).toHaveBeenCalledWith(null)
    await registry.execute('/target', ctx)
    expect(errors[0]).toContain('使い方')
  })

  it('/target の選択失敗(throw)はエラー表示になる', async () => {
    const { ctx, errors } = makeTestContext({
      selectTarget: vi.fn(() => {
        throw new Error('「tree-1」は対象にできません')
      }),
    })
    await makeRegistry().execute('/target tree-1', ctx)
    expect(errors[0]).toContain('対象にできません')
  })
})

describe('/dash(自分バフスキル)', () => {
  it('発動するとCDが始まり、CD中の再実行は黙って無視される', async () => {
    const registry = makeRegistry()
    const { ctx, api, errors } = makeTestContext()
    await registry.execute('/dash', ctx)
    expect(api.dash).toHaveBeenCalledTimes(1)
    await registry.execute('/dash', ctx)
    expect(api.dash).toHaveBeenCalledTimes(1)
    expect(errors).toHaveLength(0)
  })

  it('発動失敗(戦闘不能でthrow)はエラー表示になりCDを消費しない', async () => {
    const registry = makeRegistry()
    const { ctx, api, errors } = makeTestContext({
      dash: vi.fn(() => {
        throw new Error('戦闘不能中は使えません')
      }),
    })
    await registry.execute('/dash', ctx)
    expect(errors[0]).toContain('戦闘不能中')
    // CD返金の確認: 直後の再実行が通る
    const { ctx: ctx2, api: api2 } = makeTestContext()
    await registry.execute('/dash', ctx2)
    expect(api2.dash).toHaveBeenCalledTimes(1)
    expect(api.dash).toHaveBeenCalledTimes(1)
  })
})

describe('ボイスチャットコマンド', () => {
  it('/vc on|off|toggle がAPIへ渡る', async () => {
    for (const mode of ['on', 'off', 'toggle'] as const) {
      const { ctx, api } = makeTestContext()
      await makeRegistry().execute(`/vc ${mode}`, ctx)
      expect(api.setVoiceEnabled).toHaveBeenCalledWith(mode)
    }
  })

  it('/vc は引数なし・不正引数でusageを表示しAPIを呼ばない', async () => {
    for (const line of ['/vc', '/vc maybe']) {
      const { ctx, api, errors } = makeTestContext()
      await makeRegistry().execute(line, ctx)
      expect(api.setVoiceEnabled).not.toHaveBeenCalled()
      expect(errors[0]).toContain('使い方')
    }
  })

  it('/mic on|off|toggle がAPIへ渡る', async () => {
    for (const mode of ['on', 'off', 'toggle'] as const) {
      const { ctx, api } = makeTestContext()
      await makeRegistry().execute(`/mic ${mode}`, ctx)
      expect(api.setMicEnabled).toHaveBeenCalledWith(mode)
    }
  })

  it('APIのthrow(マイク許可拒否など)はエラー表示になりUIを壊さない', async () => {
    const { ctx, errors } = makeTestContext({
      setVoiceEnabled: vi.fn(async () => {
        throw new Error('Permission denied')
      }),
    })
    await makeRegistry().execute('/vc on', ctx)
    expect(errors[0]).toContain('Permission denied')
  })

  it('/voice がウィンドウを開く', async () => {
    const { ctx, api } = makeTestContext()
    await makeRegistry().execute('/voice', ctx)
    expect(api.openVoice).toHaveBeenCalled()
  })
})

describe('発音モードコマンド', () => {
  it('/vc mode <normal|broadcast|whisper> がAPIへ渡る', async () => {
    for (const mode of ['normal', 'broadcast', 'whisper'] as const) {
      const { ctx, api } = makeTestContext()
      await makeRegistry().execute(`/vc mode ${mode}`, ctx)
      expect(api.setVoiceMode).toHaveBeenCalledWith(mode, undefined)
    }
  })

  it('/vc mode whisper 8 は半径つきで渡る', async () => {
    const { ctx, api } = makeTestContext()
    await makeRegistry().execute('/vc mode whisper 8', ctx)
    expect(api.setVoiceMode).toHaveBeenCalledWith('whisper', 8)
  })

  it('/vc mode の半径は1〜15にクランプされる', async () => {
    const { ctx, api } = makeTestContext()
    await makeRegistry().execute('/vc mode whisper 100', ctx)
    expect(api.setVoiceMode).toHaveBeenCalledWith('whisper', 15)
  })

  it('/vc mode の不正モード・不正半径はusageを表示しAPIを呼ばない', async () => {
    for (const line of ['/vc mode', '/vc mode shout', '/vc mode whisper abc']) {
      const { ctx, api, errors } = makeTestContext()
      await makeRegistry().execute(line, ctx)
      expect(api.setVoiceMode).not.toHaveBeenCalled()
      expect(errors[0]).toContain('使い方')
    }
  })

  it('/broadcast はブロードキャストとのトグル', async () => {
    const { ctx, api } = makeTestContext()
    await makeRegistry().execute('/broadcast', ctx)
    expect(api.setVoiceMode).toHaveBeenCalledWith('broadcast', undefined)

    const back = makeTestContext({ getVoiceMode: vi.fn(() => 'broadcast' as const) })
    await makeRegistry().execute('/broadcast', back.ctx)
    expect(back.api.setVoiceMode).toHaveBeenCalledWith('normal', undefined)
  })

  it('/whisper はウィスパーとのトグル', async () => {
    const { ctx, api } = makeTestContext()
    await makeRegistry().execute('/whisper', ctx)
    expect(api.setVoiceMode).toHaveBeenCalledWith('whisper', undefined)

    const back = makeTestContext({ getVoiceMode: vi.fn(() => 'whisper' as const) })
    await makeRegistry().execute('/whisper', back.ctx)
    expect(back.api.setVoiceMode).toHaveBeenCalledWith('normal', undefined)
  })

  it('/whisper 8 はトグルせず半径つきでウィスパーに設定する', async () => {
    // ウィスパー中でも半径指定ならnormalへ戻らない(半径変更として機能)
    const { ctx, api } = makeTestContext({ getVoiceMode: vi.fn(() => 'whisper' as const) })
    await makeRegistry().execute('/whisper 8', ctx)
    expect(api.setVoiceMode).toHaveBeenCalledWith('whisper', 8)
  })

  it('/whisper の不正半径はusageを表示しAPIを呼ばない', async () => {
    const { ctx, api, errors } = makeTestContext()
    await makeRegistry().execute('/whisper abc', ctx)
    expect(api.setVoiceMode).not.toHaveBeenCalled()
    expect(errors[0]).toContain('使い方')
  })

  it('/world は一覧を表示し、現在地に▶をつける', async () => {
    const { ctx, printed } = makeTestContext({
      getWorlds: vi.fn(() => [
        { id: 'square', name: 'はじまりの広場' },
        { id: 'forest', name: '森' },
      ]),
      getCurrentWorld: vi.fn(() => ({ id: 'square', name: 'はじまりの広場' })),
    })
    await makeRegistry().execute('/world', ctx)
    expect(printed[0]).toBe('▶ square: はじまりの広場')
    expect(printed[1]).toBe('forest: 森')
  })

  it('/world <id> は切替APIを呼び、現在地なら呼ばない', async () => {
    const { ctx, api } = makeTestContext({
      getCurrentWorld: vi.fn(() => ({ id: 'square', name: '広場' })),
    })
    await makeRegistry().execute('/world forest', ctx)
    expect(api.switchWorld).toHaveBeenCalledWith('forest')

    const same = makeTestContext({
      getCurrentWorld: vi.fn(() => ({ id: 'square', name: '広場' })),
    })
    await makeRegistry().execute('/world square', same.ctx)
    expect(same.api.switchWorld).not.toHaveBeenCalled()
  })

  it('/world の切替失敗はエラー表示する', async () => {
    const { ctx, errors } = makeTestContext({
      switchWorld: vi.fn(async () => {
        throw new Error('404 Not Found')
      }),
    })
    await makeRegistry().execute('/world nope', ctx)
    expect(errors[0]).toContain('404')
  })
})
