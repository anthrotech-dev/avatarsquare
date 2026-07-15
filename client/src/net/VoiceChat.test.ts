import { describe, expect, it } from 'vitest'
import { whisperFactor } from './VoiceChat'

describe('whisperFactor(ウィスパーの距離ゲート)', () => {
  it('半径内は1、半径外は0', () => {
    expect(whisperFactor(0, 5)).toBe(1)
    expect(whisperFactor(5, 5)).toBe(1) // 境界は聞こえる側
    expect(whisperFactor(5.01, 5)).toBe(0)
    expect(whisperFactor(30, 5)).toBe(0)
  })
})
