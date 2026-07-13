/**
 * DataChannelを流れるゲームメッセージの定義。
 * Goサーバーは中身を解釈しないため、型定義はここに集約する。
 */

export interface PosMessage {
  t: 'pos'
  x: number
  /** ジャンプ中の高さ。旧クライアントは送らないため受信側は ?? 0 で扱う */
  y?: number
  z: number
  yaw: number
  moving: boolean
}

/**
 * アクション実行の通知。エフェクトは映像キャプチャに乗らないため、
 * 受信側でもワールド空間に生成する。座標は実行時点のもの
 * (posのlerp遅延に依存させない)。
 */
export interface ActMessage {
  t: 'act'
  /** アクション名。プラグイン拡張を見据えて自由文字列 */
  name: string
  x: number
  z: number
  yaw: number
  /** 対象地点(射撃など対象を取るアクションのみ) */
  tx?: number
  tz?: number
}

/**
 * プレイヤー名の通知。identityはサーバー検証(英数のみ)があるため
 * 表示名はこのメッセージで配る。接続直後・名前変更時・新規参加者の入室時に送る。
 */
export interface ProfileMessage {
  t: 'profile'
  name: string
}

/**
 * チャット発言。発言時点の表示名を同梱する。identity→名前の解決に
 * profileを使うと入室直後の再送とのレースで名前未解決が起き得るため、
 * メッセージ自体に名前を持たせる(名前詐称は許容: 厳密さより自由の方針)。
 */
export interface ChatMessage {
  t: 'chat'
  /** 発言時点の表示名。空なら受信側でidentityにフォールバックする */
  name: string
  text: string
}

export type GameMessage = PosMessage | ActMessage | ProfileMessage | ChatMessage

export const MAX_NAME_LENGTH = 24
export const MAX_CHAT_LENGTH = 200

/**
 * 制御文字・ゼロ幅文字を除き、コードポイント単位でクランプする
 * (サロゲートペアを壊さない)。
 */
function sanitizeText(input: string, maxLength: number): string {
  const cleaned = input
    // biome-ignore lint/suspicious/noControlCharactersInRegex: 制御文字の除去が目的
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\ufeff]/g, '')
    .trim()
  return [...cleaned].slice(0, maxLength).join('')
}

/**
 * 表示名の正規化。送信側(入力時)と受信側(相手のクライアント改造対策)の
 * 両方で通す。
 */
export function sanitizeName(input: string): string {
  return sanitizeText(input, MAX_NAME_LENGTH)
}

/** チャット本文の正規化。sanitizeNameと同じく送信側・受信側の両方で通す */
export function sanitizeChatText(input: string): string {
  return sanitizeText(input, MAX_CHAT_LENGTH)
}

const MESSAGE_TYPES = new Set(['pos', 'act', 'profile', 'chat'])

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export function encodeMessage(message: GameMessage): Uint8Array<ArrayBuffer> {
  // TextEncoderは常に新しいArrayBufferを確保するためキャストは安全
  return encoder.encode(JSON.stringify(message)) as Uint8Array<ArrayBuffer>
}

export function decodeMessage(data: Uint8Array): GameMessage | null {
  try {
    const parsed = JSON.parse(decoder.decode(data)) as GameMessage
    if (parsed && MESSAGE_TYPES.has(parsed.t)) return parsed
    return null
  } catch {
    return null
  }
}
