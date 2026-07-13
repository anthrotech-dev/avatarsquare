/**
 * トークンサーバーのエンドポイント設定。
 * 優先順: ?endpoint=クエリ > localStorage(UIから編集) > VITE_TOKEN_URL > デフォルト
 */

export const DEFAULT_ENDPOINT = 'https://avatar-square.tunnel.anthrotech.dev/token'

const STORAGE_KEY = 'avatarsquare:endpoint'

/** ホスト名だけの入力なども https://host/token に補完する。不正なら null */
export function normalizeEndpoint(input: string): string | null {
  const raw = input.trim()
  if (!raw) return null
  const withScheme = raw.includes('://') ? raw : `https://${raw}`
  try {
    const url = new URL(withScheme)
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
