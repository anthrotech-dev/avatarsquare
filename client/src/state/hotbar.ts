/**
 * ホットバーのスロット定義と永続化。
 * スロットの中身は「コマンド文字列」に統一する(すべての操作はコマンド)。
 */

export interface HotbarSlot {
  command: string
  label: string
}

/** キー1〜9, 0 に対応 */
export const HOTBAR_SIZE = 10

const STORAGE_KEY = 'avatarsquare:hotbar'

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

export const DEFAULT_HOTBAR: (HotbarSlot | null)[] = [
  { command: '/jump', label: 'ジャンプ' },
  { command: '/attack', label: '斬撃' },
  { command: '/shoot', label: '射撃' },
  { command: '/emote VRMA_02', label: '挨拶' },
  { command: '/emote VRMA_03', label: 'ピース' },
  { command: '/emote VRMA_05', label: '回る' },
  { command: '/emote VRMA_07', label: '屈伸' },
  null,
  null,
  null,
]

function isSlot(value: unknown): value is HotbarSlot {
  const slot = value as HotbarSlot | null
  return typeof slot?.command === 'string' && typeof slot?.label === 'string'
}

export function loadHotbar(storage: StorageLike = localStorage): (HotbarSlot | null)[] {
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) return [...DEFAULT_HOTBAR]
    const parsed = JSON.parse(raw) as unknown[]
    if (!Array.isArray(parsed)) return [...DEFAULT_HOTBAR]
    return Array.from({ length: HOTBAR_SIZE }, (_, i) => (isSlot(parsed[i]) ? parsed[i] : null))
  } catch {
    return [...DEFAULT_HOTBAR]
  }
}

export function saveHotbar(
  slots: (HotbarSlot | null)[],
  storage: StorageLike = localStorage,
): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(slots.slice(0, HOTBAR_SIZE)))
}

/** スロットa,bの中身を入れ替えた新しい配列を返す */
export function swapSlots(
  slots: (HotbarSlot | null)[],
  a: number,
  b: number,
): (HotbarSlot | null)[] {
  const next = [...slots]
  if (a < 0 || b < 0 || a >= next.length || b >= next.length) return next
  ;[next[a], next[b]] = [next[b], next[a]]
  return next
}
