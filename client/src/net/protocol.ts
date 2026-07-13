/**
 * DataChannelを流れるゲームメッセージの定義。
 * Goサーバーは中身を解釈しないため、型定義はここに集約する。
 */

export interface PosMessage {
  t: 'pos'
  x: number
  z: number
  yaw: number
  moving: boolean
}

export type GameMessage = PosMessage

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export function encodeMessage(message: GameMessage): Uint8Array<ArrayBuffer> {
  // TextEncoderは常に新しいArrayBufferを確保するためキャストは安全
  return encoder.encode(JSON.stringify(message)) as Uint8Array<ArrayBuffer>
}

export function decodeMessage(data: Uint8Array): GameMessage | null {
  try {
    const parsed = JSON.parse(decoder.decode(data)) as GameMessage
    if (parsed && parsed.t === 'pos') return parsed
    return null
  } catch {
    return null
  }
}
