import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MASTER_VOLUME,
  DEFAULT_NOISE_GATE,
  loadMasterVolume,
  loadMicDeviceId,
  loadNoiseGate,
  meterPosToRms,
  rmsToMeterPos,
  saveMasterVolume,
  saveMicDeviceId,
  saveNoiseGate,
} from './voice'

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
  }
}

describe('マスター音量の永続化', () => {
  it('保存した値を復元できる', () => {
    const storage = memoryStorage()
    saveMasterVolume(0.4, storage)
    expect(loadMasterVolume(storage)).toBe(0.4)
  })

  it('未保存は既定値', () => {
    expect(loadMasterVolume(memoryStorage())).toBe(DEFAULT_MASTER_VOLUME)
  })

  it('不正値は既定値にフォールバックする', () => {
    const storage = memoryStorage({ 'avatarsquare:voiceMasterVolume': 'abc' })
    expect(loadMasterVolume(storage)).toBe(DEFAULT_MASTER_VOLUME)
  })

  it('範囲外は0〜1にクランプされる(保存時・読出し時とも)', () => {
    const storage = memoryStorage()
    saveMasterVolume(2, storage)
    expect(loadMasterVolume(storage)).toBe(1)
    const negative = memoryStorage({ 'avatarsquare:voiceMasterVolume': '-0.5' })
    expect(loadMasterVolume(negative)).toBe(0)
  })

  it('storageがthrowしても既定値を返す', () => {
    const broken = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
    }
    expect(loadMasterVolume(broken)).toBe(DEFAULT_MASTER_VOLUME)
    expect(() => saveMasterVolume(0.5, broken)).not.toThrow()
  })
})

describe('マイクデバイスの永続化', () => {
  it('保存した値を復元できる。未保存は空文字', () => {
    const storage = memoryStorage()
    expect(loadMicDeviceId(storage)).toBe('')
    saveMicDeviceId('device-123', storage)
    expect(loadMicDeviceId(storage)).toBe('device-123')
  })
})

describe('ノイズゲートの永続化', () => {
  it('保存した値を復元できる。未保存・不正値は既定値', () => {
    const storage = memoryStorage()
    expect(loadNoiseGate(storage)).toBe(DEFAULT_NOISE_GATE)
    saveNoiseGate(0.1, storage)
    expect(loadNoiseGate(storage)).toBe(0.1)
    expect(loadNoiseGate(memoryStorage({ 'avatarsquare:noiseGate': 'x' }))).toBe(DEFAULT_NOISE_GATE)
  })

  it('範囲外は0〜1にクランプされる', () => {
    const storage = memoryStorage()
    saveNoiseGate(-1, storage)
    expect(loadNoiseGate(storage)).toBe(0)
  })
})

describe('メータースケール変換(dB)', () => {
  it('往復変換が一致する', () => {
    for (const rms of [0.01, 0.02, 0.1, 0.5, 1]) {
      expect(meterPosToRms(rmsToMeterPos(rms))).toBeCloseTo(rms, 6)
    }
  })

  it('端の値: 0は左端(ゲート無効)、1は右端', () => {
    expect(rmsToMeterPos(0)).toBe(0)
    expect(meterPosToRms(0)).toBe(0)
    expect(rmsToMeterPos(1)).toBe(1)
    expect(meterPosToRms(1)).toBe(1)
  })

  it('単調増加(スライダーを右に動かすほど閾値が上がる)', () => {
    expect(meterPosToRms(0.3)).toBeLessThan(meterPosToRms(0.6))
    expect(rmsToMeterPos(0.02)).toBeGreaterThan(rmsToMeterPos(0.005))
  })
})
