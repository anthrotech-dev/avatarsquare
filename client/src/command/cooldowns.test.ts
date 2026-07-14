import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getCooldown, resetCooldowns, subscribeCooldowns, tryStartCooldown } from './cooldowns'

describe('cooldowns', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['performance'] })
    resetCooldowns()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('CD中でなければ開始でき、CD中は開始できない', () => {
    expect(tryStartCooldown(['attack'], 3000)).toBe(true)
    expect(tryStartCooldown(['attack'], 3000)).toBe(false)
  })

  it('期限切れ後は再び開始できる', () => {
    expect(tryStartCooldown(['attack'], 3000)).toBe(true)
    vi.advanceTimersByTime(3000)
    expect(tryStartCooldown(['attack'], 3000)).toBe(true)
  })

  it('aliasのキーでも同じCDを引ける', () => {
    tryStartCooldown(['attack', 'slash'], 3000)
    expect(getCooldown('slash')).toBe(getCooldown('attack'))
    expect(getCooldown('slash')).not.toBeNull()
  })

  it('getCooldownは未登録・終了済みでnullを返す', () => {
    expect(getCooldown('attack')).toBeNull()
    tryStartCooldown(['attack'], 3000)
    expect(getCooldown('attack')).not.toBeNull()
    vi.advanceTimersByTime(3000)
    expect(getCooldown('attack')).toBeNull()
  })

  it('コマンドごとに独立している', () => {
    tryStartCooldown(['attack'], 3000)
    expect(tryStartCooldown(['shoot'], 3000)).toBe(true)
  })

  it('開始時に購読者へ通知する。unsubscribe後は通知しない', () => {
    const fn = vi.fn()
    const unsubscribe = subscribeCooldowns(fn)
    tryStartCooldown(['attack'], 3000)
    expect(fn).toHaveBeenCalledTimes(1)
    // CD中の失敗した開始は通知しない
    tryStartCooldown(['attack'], 3000)
    expect(fn).toHaveBeenCalledTimes(1)
    unsubscribe()
    vi.advanceTimersByTime(3000)
    tryStartCooldown(['attack'], 3000)
    expect(fn).toHaveBeenCalledTimes(1)
  })
})
