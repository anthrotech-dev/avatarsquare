export type BuffKind = 'buff' | 'debuff'

/**
 * バフ・デバフのHUD表示用スナップショット。自分バフ(Game権威)と
 * ターゲットバフ(ノード属性buffsのワイヤ形式を正規化)の両方で使う
 */
export interface BuffInfo {
  id: string
  name: string
  kind: BuffKind
  /** performance.now()基準の終了時刻。null=永続(残り時間表示なし) */
  expiresAt: number | null
  /** 付与時の全長ms(表示用)。永続はnull */
  durationMs: number | null
}

/** 自分に付与するバフの定義。効果はクライアント権威で適用する */
export interface SelfBuffDef {
  id: string
  name: string
  kind: BuffKind
  durationMs: number
  effects?: { speedMultiplier?: number }
}

/**
 * ノードの汎用属性buffs(ワイヤ形式)をBuffInfoへ正規化する。
 * ワイヤのremainingMsは「送信時点の残り時間」なので、受信時刻を起点に
 * expiresAtへ変換し、以後はクライアント時計でカウントダウンする。
 * remainingMs省略は永続バフ。id/name欠落やkind不正の要素はスキップ
 */
export function normalizeBuffs(raw: unknown, receivedAt: number): BuffInfo[] {
  if (!Array.isArray(raw)) return []
  const out: BuffInfo[] = []
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue
    const e = entry as Record<string, unknown>
    if (typeof e.id !== 'string' || e.id === '') continue
    if (typeof e.name !== 'string' || e.name === '') continue
    if (e.kind !== 'buff' && e.kind !== 'debuff') continue
    const remainingMs = typeof e.remainingMs === 'number' ? e.remainingMs : null
    const durationMs = typeof e.durationMs === 'number' ? e.durationMs : remainingMs
    out.push({
      id: e.id,
      name: e.name,
      kind: e.kind,
      expiresAt: remainingMs !== null ? receivedAt + remainingMs : null,
      durationMs,
    })
  }
  return out
}
