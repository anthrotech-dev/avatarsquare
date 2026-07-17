/**
 * ホットバーのスロット定義と永続化。
 * スロットの中身は「コマンド文字列」に統一する(すべての操作はコマンド)。
 * ホットバーは複数持て、seqで識別する。表示から削除してもactive=falseに
 * するだけで割当・キー設定は保持し、再追加時に同じseqの設定が復活する。
 */

import { DEFAULT_KEYBINDS, isKeybind, type SlotKeybind } from './keybinds'

export interface HotbarSlot {
  command: string
  label: string
}

export interface HotbarData {
  /** ホットバー0,1,2… 永続の識別番号 */
  seq: number
  /** false=表示から削除済み(設定は保持) */
  active: boolean
  slots: (HotbarSlot | null)[]
  keys: (SlotKeybind | null)[]
}

/** 1本あたりのスロット数。デフォルトキーは1〜9,0,-,^ */
export const HOTBAR_SIZE = 12

const STORAGE_KEY = 'avatarsquare:hotbars'
/** 単一ホットバー時代(v1)の保存キー。読み替え用に残す */
const LEGACY_SLOTS_KEY = 'avatarsquare:hotbar'
const LEGACY_KEYS_KEY = 'avatarsquare:hotbarKeys'

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

/** Spaceのジャンプ・Enterのチャット入力も固定キーではなくホットバー割当(index 10,11)で発火する */
export const DEFAULT_HOTBAR: (HotbarSlot | null)[] = [
  { command: '/attack', label: '斬撃' },
  { command: '/shoot', label: '射撃' },
  { command: '/emote VRMA_02', label: '挨拶' },
  { command: '/emote VRMA_03', label: 'ピース' },
  { command: '/emote VRMA_05', label: '回る' },
  { command: '/emote VRMA_07', label: '屈伸' },
  { command: '/dash', label: 'ダッシュ' },
  null,
  null,
  { command: '/settings', label: '設定' },
  { command: '/jump', label: 'ジャンプ' },
  { command: '/chat', label: 'チャット' },
]

function isSlot(value: unknown): value is HotbarSlot {
  const slot = value as HotbarSlot | null
  return typeof slot?.command === 'string' && typeof slot?.label === 'string'
}

/** 長さHOTBAR_SIZEに揃え、各要素をバリデーションする */
function normalizeSlots(values: unknown[]): (HotbarSlot | null)[] {
  return Array.from({ length: HOTBAR_SIZE }, (_, i) => (isSlot(values[i]) ? values[i] : null))
}

function normalizeKeys(values: unknown[]): (SlotKeybind | null)[] {
  return Array.from({ length: HOTBAR_SIZE }, (_, i) => (isKeybind(values[i]) ? values[i] : null))
}

function defaultHotbar(): HotbarData {
  return { seq: 0, active: true, slots: [...DEFAULT_HOTBAR], keys: [...DEFAULT_KEYBINDS] }
}

function isHotbarData(value: unknown): value is HotbarData {
  const data = value as HotbarData | null
  return (
    typeof data?.seq === 'number' &&
    typeof data?.active === 'boolean' &&
    Array.isArray(data?.slots) &&
    Array.isArray(data?.keys)
  )
}

/** v1(単一ホットバー)の保存データをHotbarData[]に読み替える。無ければnull */
function loadLegacy(storage: StorageLike): HotbarData[] | null {
  const rawSlots = storage.getItem(LEGACY_SLOTS_KEY)
  const rawKeys = storage.getItem(LEGACY_KEYS_KEY)
  if (!rawSlots && !rawKeys) return null
  const parsedSlots = rawSlots ? (JSON.parse(rawSlots) as unknown[]) : []
  const parsedKeys = rawKeys ? (JSON.parse(rawKeys) as unknown[]) : [...DEFAULT_KEYBINDS]
  if (!Array.isArray(parsedSlots) || !Array.isArray(parsedKeys)) return null
  // 12スロット化で増えた分(旧配列より後ろ)はデフォルトキーで補う
  const keys = normalizeKeys(parsedKeys).map((bind, i) =>
    i < parsedKeys.length ? bind : DEFAULT_KEYBINDS[i],
  )
  return [{ seq: 0, active: true, slots: normalizeSlots(parsedSlots), keys }]
}

export function loadHotbars(storage: StorageLike = localStorage): HotbarData[] {
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as unknown[]
      if (!Array.isArray(parsed)) return [defaultHotbar()]
      const hotbars = parsed.filter(isHotbarData).map((data) => ({
        seq: data.seq,
        active: data.active,
        slots: normalizeSlots(data.slots),
        keys: normalizeKeys(data.keys),
      }))
      return hotbars.length > 0 ? hotbars : [defaultHotbar()]
    }
    return loadLegacy(storage) ?? [defaultHotbar()]
  } catch {
    return [defaultHotbar()]
  }
}

export function saveHotbars(hotbars: HotbarData[], storage: StorageLike = localStorage): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(hotbars))
  } catch {
    // 保存できなくてもセッション中は有効
  }
}

/**
 * ホットバーを1本追加する。非アクティブがあれば最小seqを復活(設定ごと戻る)、
 * 無ければmax+1のseqで空のホットバーを新規作成する。
 */
export function activateHotbar(hotbars: HotbarData[]): HotbarData[] {
  const revive = hotbars
    .filter((h) => !h.active)
    .reduce<HotbarData | null>((min, h) => (min === null || h.seq < min.seq ? h : min), null)
  if (revive) return hotbars.map((h) => (h.seq === revive.seq ? { ...h, active: true } : h))
  const seq = hotbars.reduce((max, h) => Math.max(max, h.seq + 1), 0)
  return [
    ...hotbars,
    {
      seq,
      active: true,
      slots: Array.from({ length: HOTBAR_SIZE }, () => null),
      keys: Array.from({ length: HOTBAR_SIZE }, () => null),
    },
  ]
}

/** ホットバーを表示から削除する。設定は保持され、activateHotbarで復活する */
export function deactivateHotbar(hotbars: HotbarData[], seq: number): HotbarData[] {
  return hotbars.map((h) => (h.seq === seq ? { ...h, active: false } : h))
}
