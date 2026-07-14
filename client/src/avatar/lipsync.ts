/**
 * 口パク(リップシンク)の信号処理。マイク音量(RMS)をVRM表情'aa'の
 * 重み(0〜1)へ変換する純関数群。WebAudioに依存しないためVitestで検証できる。
 */

import { DEFAULT_NOISE_GATE } from '../state/voice'

/** RMS→重みのゲイン。通常の発話(RMS 0.05〜0.15)で口がしっかり動く程度 */
const GAIN = 8
/** 立ち上がり(開口)の時定数。速くしないと子音で口が追従しない */
const ATTACK_TAU = 0.04 // 秒
/** 立ち下がり(閉口)の時定数。ゆっくり閉じるほうが自然に見える */
const RELEASE_TAU = 0.18 // 秒

/** AnalyserNodeのgetByteTimeDomainData(中心128)の生データからRMSを求める */
export function rmsFromTimeDomain(data: Uint8Array): number {
  if (data.length === 0) return 0
  let sum = 0
  for (const v of data) {
    const centered = (v - 128) / 128
    sum += centered * centered
  }
  return Math.sqrt(sum / data.length)
}

/**
 * RMSから目標の口開き重みを求める。ゲート未満は0、以降は線形+clamp。
 * gateはユーザー設定のノイズゲート閾値(設定パネルで調整、これ未満は送信もされない)。
 */
export function mouthTarget(rms: number, gate: number = DEFAULT_NOISE_GATE): number {
  if (rms < gate || rms <= 0) return 0
  return Math.min((rms - gate) * GAIN, 1)
}

/**
 * 口開き重みを目標値へ指数追従させる。開口(attack)は速く、
 * 閉口(release)は遅く追従させて自然な口の動きにする。
 */
export function stepMouth(current: number, target: number, delta: number): number {
  const tau = target > current ? ATTACK_TAU : RELEASE_TAU
  return current + (target - current) * (1 - Math.exp(-delta / tau))
}

/**
 * 自分の「発話中」判定のホールド時間(秒)。
 * 音節の切れ目や息継ぎで表示がチカチカしないよう、声が途切れても
 * この時間は発話中扱いを続ける。
 */
export const SPEAK_HOLD = 0.3

/**
 * 発話中判定の残り時間を進める。声が入っている間はホールド満タン、
 * 途切れたらdeltaずつ減る。残り>0が「発話中」。
 * (自分のネームプレートはSFU往復のActiveSpeakersChangedだと遅れるため、
 * ローカルのマイク音量からこれでリアルタイムに判定する)
 */
export function stepSpeakingHold(hold: number, voiced: boolean, delta: number): number {
  return voiced ? SPEAK_HOLD : Math.max(0, hold - delta)
}
