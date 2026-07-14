/**
 * ボイスチャット設定の永続化。
 * マスター音量とマイクデバイスのみ保存する。プレイヤー個別の音量は
 * identity(user-<乱数>)が接続ごとに変わるため永続化しない(セッション内のみ)。
 */

const MASTER_VOLUME_KEY = 'avatarsquare:voiceMasterVolume'
const MIC_DEVICE_KEY = 'avatarsquare:micDevice'
const NOISE_GATE_KEY = 'avatarsquare:noiseGate'

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

export const DEFAULT_MASTER_VOLUME = 1
/** ノイズゲート閾値(RMS)の既定値。通常の環境ノイズを切る程度 */
export const DEFAULT_NOISE_GATE = 0.02

/** マスター音量(0〜1)。不正値・未保存は既定値 */
export function loadMasterVolume(storage: StorageLike = localStorage): number {
  try {
    const raw = storage.getItem(MASTER_VOLUME_KEY)
    if (raw === null) return DEFAULT_MASTER_VOLUME
    const value = Number(raw)
    if (!Number.isFinite(value)) return DEFAULT_MASTER_VOLUME
    return Math.min(Math.max(value, 0), 1)
  } catch {
    return DEFAULT_MASTER_VOLUME
  }
}

export function saveMasterVolume(volume: number, storage: StorageLike = localStorage): void {
  try {
    storage.setItem(MASTER_VOLUME_KEY, String(Math.min(Math.max(volume, 0), 1)))
  } catch {
    // 保存できなくてもセッション中は有効
  }
}

/** ノイズゲート閾値(RMS、0〜1)。これ未満の音は無音扱い=送信もされない */
export function loadNoiseGate(storage: StorageLike = localStorage): number {
  try {
    const raw = storage.getItem(NOISE_GATE_KEY)
    if (raw === null) return DEFAULT_NOISE_GATE
    const value = Number(raw)
    if (!Number.isFinite(value)) return DEFAULT_NOISE_GATE
    return Math.min(Math.max(value, 0), 1)
  } catch {
    return DEFAULT_NOISE_GATE
  }
}

export function saveNoiseGate(gate: number, storage: StorageLike = localStorage): void {
  try {
    storage.setItem(NOISE_GATE_KEY, String(Math.min(Math.max(gate, 0), 1)))
  } catch {
    // 保存できなくてもセッション中は有効
  }
}

/**
 * メーター/ゲートスライダーの表示レンジ下限(dB)。
 * RMSは対数感覚の音量に対して極端に下に詰まるため、UIはdBスケールで扱う
 * (Discordの入力感度と同じ見せ方)。
 */
const METER_MIN_DB = -60

/** RMS(0〜1)をメーター/スライダー上の位置(0〜1)へ。0は左端 */
export function rmsToMeterPos(rms: number): number {
  if (rms <= 0) return 0
  const db = 20 * Math.log10(rms)
  return Math.min(Math.max((db - METER_MIN_DB) / -METER_MIN_DB, 0), 1)
}

/** メーター位置(0〜1)をRMSへ。左端(0)はゲート無効=常に開 */
export function meterPosToRms(pos: number): number {
  if (pos <= 0) return 0
  return 10 ** ((Math.min(pos, 1) * -METER_MIN_DB + METER_MIN_DB) / 20)
}

/** マイクデバイスID。未保存は空文字(=ブラウザ既定) */
export function loadMicDeviceId(storage: StorageLike = localStorage): string {
  try {
    return storage.getItem(MIC_DEVICE_KEY) ?? ''
  } catch {
    return ''
  }
}

export function saveMicDeviceId(deviceId: string, storage: StorageLike = localStorage): void {
  try {
    storage.setItem(MIC_DEVICE_KEY, deviceId)
  } catch {
    // 保存できなくてもセッション中は有効
  }
}
