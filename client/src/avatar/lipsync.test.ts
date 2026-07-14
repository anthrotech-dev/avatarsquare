import { describe, expect, it } from 'vitest'
import { mouthTarget, rmsFromTimeDomain, SPEAK_HOLD, stepMouth, stepSpeakingHold } from './lipsync'

describe('rmsFromTimeDomain', () => {
  it('無音(全て128)は0', () => {
    expect(rmsFromTimeDomain(new Uint8Array(64).fill(128))).toBe(0)
  })

  it('フルスケール矩形波は約1', () => {
    const data = new Uint8Array(64)
    for (let i = 0; i < data.length; i++) data[i] = i % 2 === 0 ? 0 : 255
    expect(rmsFromTimeDomain(data)).toBeGreaterThan(0.98)
    expect(rmsFromTimeDomain(data)).toBeLessThanOrEqual(1.01)
  })

  it('空配列は0', () => {
    expect(rmsFromTimeDomain(new Uint8Array(0))).toBe(0)
  })
})

describe('mouthTarget', () => {
  it('ノイズゲート未満は0', () => {
    expect(mouthTarget(0)).toBe(0)
    expect(mouthTarget(0.01)).toBe(0)
  })

  it('大きい入力は1にクランプ', () => {
    expect(mouthTarget(1)).toBe(1)
  })

  it('通常の発話レベルで中間値になる', () => {
    const w = mouthTarget(0.08)
    expect(w).toBeGreaterThan(0.2)
    expect(w).toBeLessThan(1)
  })

  it('ゲート閾値を指定できる(設定パネルのノイズゲート)', () => {
    expect(mouthTarget(0.08, 0.1)).toBe(0) // 閾値を上げると同じ音量でも無音扱い
    expect(mouthTarget(0.08, 0.01)).toBeGreaterThan(0)
  })

  it('ゲート0(無効)でも無音(rms=0)では開かない', () => {
    expect(mouthTarget(0, 0)).toBe(0)
    expect(mouthTarget(0.001, 0)).toBeGreaterThan(0)
  })
})

describe('stepMouth', () => {
  it('開口(attack)は閉口(release)より速い', () => {
    const dt = 0.016
    const opened = stepMouth(0, 1, dt) // 0→1へ
    const closed = 1 - stepMouth(1, 0, dt) // 1→0への進み分
    expect(opened).toBeGreaterThan(closed)
  })

  it('目標値へ収束する', () => {
    let v = 0
    for (let i = 0; i < 120; i++) v = stepMouth(v, 1, 0.016)
    expect(v).toBeGreaterThan(0.99)
    for (let i = 0; i < 240; i++) v = stepMouth(v, 0, 0.016)
    expect(v).toBeLessThan(0.01)
  })

  it('deltaが大きくてもオーバーシュートしない', () => {
    expect(stepMouth(0, 1, 5)).toBeLessThanOrEqual(1)
    expect(stepMouth(1, 0, 5)).toBeGreaterThanOrEqual(0)
  })
})

describe('stepSpeakingHold(発話中判定)', () => {
  it('声が入った瞬間に発話中(>0)になる', () => {
    expect(stepSpeakingHold(0, true, 0.016)).toBeGreaterThan(0)
  })

  it('声が途切れてもホールド時間は発話中を保ち、過ぎると0になる', () => {
    let hold = stepSpeakingHold(0, true, 0.016)
    hold = stepSpeakingHold(hold, false, SPEAK_HOLD / 2)
    expect(hold).toBeGreaterThan(0) // まだ発話中
    hold = stepSpeakingHold(hold, false, SPEAK_HOLD)
    expect(hold).toBe(0) // ホールド切れ
  })

  it('無音が続いても負にならない', () => {
    expect(stepSpeakingHold(0, false, 1)).toBe(0)
  })
})
