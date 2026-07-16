/**
 * DataChannelを流れるゲームメッセージの定義(Go側のミラーはserver/scene)。
 * プレイヤー間メッセージ(pos/act/chat等)はクライアント同士で交換し、
 * シーン系メッセージ(gpatch/gsnap/gevent)はワールドボット(サーバー)だけが
 * 発行する権威更新。クライアントは送信者identityで検証する。
 */

/** ワールドボット(サーバー)のidentity。シーン系メッセージの唯一の正規送信者 */
export const WORLD_BOT_ID = '__world'
/** システム参加者のprefix。プレイヤー扱いしない(サーバーがトークン発行を拒否する) */
export const SYSTEM_ID_PREFIX = '__'

/** システム参加者(ワールドボット等)か。プレイヤー一覧・人数から除外する */
export function isSystemId(id: string): boolean {
  return id.startsWith(SYSTEM_ID_PREFIX)
}

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

/**
 * 発話中(VCのノイズゲートが開いている)状態の通知。変化時のみ送る。
 * SFUのActiveSpeakers検出はゲート済み無音+DTXで長時間沈黙すると
 * 復帰後に働かなくなることがあり、また往復遅延もあるため、
 * 送信側のローカル判定(=実際に送信されているか)を正とする。
 * 詐称は可能だが許容(厳密さより自由の方針)。
 */
export interface SpeakMessage {
  t: 'spk'
  on: boolean
}

/** 発音モード。broadcast=距離減衰なしで全員へ、whisper=半径内のみ */
export const VOICE_MODES = ['normal', 'broadcast', 'whisper'] as const
export type VoiceMode = (typeof VOICE_MODES)[number]

export const WHISPER_RADIUS_DEFAULT = 5
export const WHISPER_RADIUS_MIN = 1
export const WHISPER_RADIUS_MAX = 15

/** ウィスパー半径のクランプ。不正値は既定値に落とす(受信側でも通す) */
export function clampWhisperRadius(radius: unknown): number {
  const n = typeof radius === 'number' && Number.isFinite(radius) ? radius : WHISPER_RADIUS_DEFAULT
  return Math.min(Math.max(n, WHISPER_RADIUS_MIN), WHISPER_RADIUS_MAX)
}

export function isVoiceMode(value: unknown): value is VoiceMode {
  return typeof value === 'string' && (VOICE_MODES as readonly string[]).includes(value)
}

/**
 * 発音モードの通知。減衰・遮断は受信側が行うため、話者がモード変更時に
 * 全員へ配り、新規参加者には再送する(profile/spkと同じパターン)。
 * spk同様に詐称は許容(厳密さより自由の方針)。
 */
export interface VoiceModeMessage {
  t: 'vmode'
  mode: VoiceMode
  /** ウィスパーの可聴半径(m)。whisper時のみ意味を持つ */
  radius?: number
}

/**
 * サーバー→全員: シーンノードの属性パッチ(権威更新)。
 * 値の意味はワールドのwasmスクリプトとクライアント描画の取り決めで、
 * プロトコルとしては解釈しない(HTMLのDOM更新に相当)。
 */
export interface ScenePatchMessage {
  t: 'gpatch'
  /** シーンノードid */
  id: string
  attrs: Record<string, unknown>
}

/**
 * サーバー→新規参加者: 初期シーンとの差分(入室直後に1回)。
 * 適用順: despawns → spawns → patches
 */
export interface SceneSnapshotMessage {
  t: 'gsnap'
  patches: Record<string, Record<string, unknown>>
  /** 現在生存中の動的スポーンノード(スポーン順) */
  spawns?: Array<{ parent?: string; node: Record<string, unknown> }>
  /** 初期シーンから消えたノードのid */
  despawns?: string[]
}

/**
 * サーバー→全員: シーンノードの動的追加。nodeはchildrenごとのsubtree
 * (SceneNode相当)。ワールドのwasmスクリプトのspawnが発行元
 */
export interface SceneSpawnMessage {
  t: 'gspawn'
  /** 追加先の親ノードid。省略時はトップレベル */
  parent?: string
  node: Record<string, unknown>
}

/** サーバー→全員: シーンノードの動的削除(子孫ごと消える) */
export interface SceneDespawnMessage {
  t: 'gdespawn'
  id: string
}

/** サーバー→全員: 一過性のシーンイベント(被弾フラッシュ等の演出トリガー) */
export interface SceneEventMessage {
  t: 'gevent'
  id: string
  name: string
  data?: Record<string, unknown>
}

/**
 * クライアント→サーバー: ノードへの入力(クリックインタラクト等)。
 * destinationIdentities: [WORLD_BOT_ID] で送る(他プレイヤーには不要)
 */
export interface SceneInputMessage {
  t: 'ginput'
  id: string
  action: string
}

export type GameMessage =
  | PosMessage
  | ActMessage
  | ProfileMessage
  | ChatMessage
  | SpeakMessage
  | VoiceModeMessage
  | ScenePatchMessage
  | SceneSnapshotMessage
  | SceneSpawnMessage
  | SceneDespawnMessage
  | SceneEventMessage
  | SceneInputMessage

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

const MESSAGE_TYPES = new Set([
  'pos',
  'act',
  'profile',
  'chat',
  'spk',
  'vmode',
  'gpatch',
  'gsnap',
  'gspawn',
  'gdespawn',
  'gevent',
  'ginput',
])

/** シーン系メッセージ(サーバー権威)か。ワールドボット以外から届いたら捨てる */
export function isSceneAuthorityMessage(
  message: GameMessage,
): message is
  | ScenePatchMessage
  | SceneSnapshotMessage
  | SceneSpawnMessage
  | SceneDespawnMessage
  | SceneEventMessage {
  return (
    message.t === 'gpatch' ||
    message.t === 'gsnap' ||
    message.t === 'gspawn' ||
    message.t === 'gdespawn' ||
    message.t === 'gevent'
  )
}

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
