/**
 * トークンサーバーのエンドポイント設定。
 * 優先順: ?endpoint=クエリ > localStorage(UIから編集) > VITE_TOKEN_URL > デフォルト
 */

// WebRTCのメディア(UDP/TCP)が通る必要があるためHTTPトンネルでは開発できない。
// 開発サーバー上のtoken-serverがTLS終端(トークンAPI + wssプロキシ)を担う。
// (.dev TLDはHSTSプリロード対象のため、平文http/wsはブラウザで使えない)
export const DEFAULT_ENDPOINT = 'https://tunnel.anthrotech.dev:8787/token'

const DEFAULT_PORT = '8787'
const STORAGE_KEY = 'avatarsquare:endpoint'

/**
 * ホスト名だけの入力を https://host:8787/token に補完する。不正なら null。
 * スキームを明示した場合はポートも入力どおりに扱う(ローカル開発は http://localhost:8787/token)。
 */
export function normalizeEndpoint(input: string): string | null {
  const raw = input.trim()
  if (!raw) return null
  const hasScheme = raw.includes('://')
  try {
    const url = new URL(hasScheme ? raw : `https://${raw}`)
    if (!hasScheme && url.port === '') url.port = DEFAULT_PORT
    if (url.pathname === '/' || url.pathname === '') url.pathname = '/token'
    return url.toString()
  } catch {
    return null
  }
}

export function getTokenEndpoint(): string {
  const fromQuery = new URLSearchParams(location.search).get('endpoint')
  const fromStorage = localStorage.getItem(STORAGE_KEY)
  const fromEnv = import.meta.env.VITE_TOKEN_URL as string | undefined
  return (
    normalizeEndpoint(fromQuery ?? '') ??
    normalizeEndpoint(fromStorage ?? '') ??
    normalizeEndpoint(fromEnv ?? '') ??
    DEFAULT_ENDPOINT
  )
}

/** 正規化して保存し、保存した値を返す */
export function saveTokenEndpoint(value: string): string {
  const normalized = normalizeEndpoint(value) ?? DEFAULT_ENDPOINT
  localStorage.setItem(STORAGE_KEY, normalized)
  return normalized
}
