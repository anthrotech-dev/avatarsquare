import { describe, expect, it } from 'vitest'
import { GRAVITY, isAirborne, JUMP_SPEED, stepVertical } from './verticalMotion'

function simulate(dt = 1 / 60): { peak: number; airTime: number } {
  let state = { y: 0, vy: JUMP_SPEED }
  let peak = 0
  let airTime = 0
  for (let i = 0; i < 1000; i++) {
    const step = stepVertical(state, dt)
    airTime += dt
    peak = Math.max(peak, step.y)
    if (step.landed) return { peak, airTime }
    state = step
  }
  throw new Error('着地しなかった')
}

describe('stepVertical', () => {
  it('地上では何も起きない', () => {
    expect(stepVertical({ y: 0, vy: 0 }, 1 / 60)).toEqual({ y: 0, vy: 0, landed: false })
  })

  it('ジャンプすると放物線を描いて着地する', () => {
    const { peak, airTime } = simulate()
    // 理論値: 最高到達 v^2/2g ≈ 1.01m、滞空 2v/g ≈ 0.64s
    expect(peak).toBeGreaterThan(0.85)
    expect(peak).toBeLessThan(1.1)
    expect(airTime).toBeGreaterThan(0.55)
    expect(airTime).toBeLessThan(0.75)
  })

  it('着地時はy=0, vy=0に正規化される', () => {
    const step = stepVertical({ y: 0.01, vy: -3 }, 1 / 60)
    expect(step).toEqual({ y: 0, vy: 0, landed: true })
  })

  it('大きなdeltaでも地面を突き抜けない', () => {
    const step = stepVertical({ y: 0.5, vy: -1 }, 0.5)
    expect(step.y).toBe(0)
    expect(step.landed).toBe(true)
  })

  it('isAirborneは上昇開始直後から着地までtrue', () => {
    expect(isAirborne({ y: 0, vy: JUMP_SPEED })).toBe(true)
    expect(isAirborne({ y: 0.5, vy: -GRAVITY * 0.1 })).toBe(true)
    expect(isAirborne({ y: 0, vy: 0 })).toBe(false)
  })
})
