/**
 * コマンドのクールダウン状態。CommandRegistryが開始/判定し、
 * UI(ホットバー)が残り時間の表示に購読する。
 * 時刻はperformance.now()基準(単調増加)で統一する。
 */

export interface CooldownEntry {
  /** performance.now()基準の終了時刻 */
  until: number
  durationMs: number
}

// 同一entryをcanonical名とalias両方のキーで共有する
const active = new Map<string, CooldownEntry>()
const listeners = new Set<() => void>()

/**
 * クールダウンの開始を試みる。CD中でなければ全names(canonical名+alias)で
 * 開始してtrue、CD中ならfalseを返す。
 */
export function tryStartCooldown(names: string[], durationMs: number): boolean {
  const now = performance.now()
  const current = active.get(names[0])
  if (current && now < current.until) return false
  const entry: CooldownEntry = { until: now + durationMs, durationMs }
  for (const name of names) active.set(name, entry)
  for (const fn of listeners) fn()
  return true
}

/** 実行中のクールダウン。未登録・終了済みはnull */
export function getCooldown(name: string): CooldownEntry | null {
  const entry = active.get(name)
  if (!entry || performance.now() >= entry.until) return null
  return entry
}

/** クールダウン開始の通知を購読する(useSyncExternalStore用)。戻り値はunsubscribe */
export function subscribeCooldowns(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** テスト用: 全クールダウンを破棄する */
export function resetCooldowns(): void {
  active.clear()
}
