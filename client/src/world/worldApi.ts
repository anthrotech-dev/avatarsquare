import { getTokenEndpoint } from '../net/config'
import { parseWorld, type WorldDef, type WorldSummary } from './WorldDef'

/**
 * ワールドサーバーAPI。トークンサーバーと同一ホスト(/worlds, /worlds/{id})から
 * ワールド一覧・ワールドJSONを取得する。
 */

/** APIベースURL。トークンエンドポイント(…/token)から導出する */
export function getApiBase(): string {
  return getTokenEndpoint().replace(/\/token\/?$/, '')
}

export async function fetchWorlds(): Promise<WorldSummary[]> {
  const res = await fetch(`${getApiBase()}/worlds`)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  const list = (await res.json()) as unknown
  if (!Array.isArray(list)) throw new Error('ワールド一覧が不正です')
  return list
    .filter((w): w is Record<string, unknown> => typeof w === 'object' && w !== null)
    .map((w) => ({ id: String(w.id ?? ''), name: String(w.name ?? '') }))
    .filter((w) => w.id !== '')
}

/**
 * ワールドJSONの取得。返り値のurlは相対アセット解決の基準。
 * JSON本体はサーバーの検証済みキャッシュ(プロキシ)から受け取るため、
 * 基準はX-World-Sourceヘッダ(取得元)を優先する。
 */
export async function fetchWorld(id: string): Promise<{ world: WorldDef; url: string }> {
  const apiUrl = `${getApiBase()}/worlds/${encodeURIComponent(id)}`
  const res = await fetch(apiUrl)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  const source = res.headers.get('X-World-Source')
  return { world: parseWorld(await res.json()), url: source || apiUrl }
}
