/**
 * ホットバー各スロットのキーバインド。任意キー+Shift/Ctrl/Alt修飾に対応する。
 * KeyboardEvent.code ベース(レイアウト非依存)。
 */

import { HOTBAR_SIZE } from './hotbar'

export interface SlotKeybind {
  code: string
  shift: boolean
  ctrl: boolean
  alt: boolean
}

/** ゲーム側で固定用途に使っているキー。修飾なしで割り当てると衝突警告を出す */
export const RESERVED_KEYS: Array<{ code: string; label: string }> = [
  { code: 'Space', label: 'ジャンプ' },
  { code: 'KeyY', label: 'カメラ切替' },
  { code: 'Enter', label: 'チャット入力' },
  { code: 'Escape', label: 'キャンセル操作' },
]

const plain = (code: string): SlotKeybind => ({ code, shift: false, ctrl: false, alt: false })

export const DEFAULT_KEYBINDS: (SlotKeybind | null)[] = [
  plain('Digit1'),
  plain('Digit2'),
  plain('Digit3'),
  plain('Digit4'),
  plain('Digit5'),
  plain('Digit6'),
  plain('Digit7'),
  plain('Digit8'),
  plain('Digit9'),
  plain('Digit0'),
]

const STORAGE_KEY = 'avatarsquare:hotbarKeys'

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

function isKeybind(value: unknown): value is SlotKeybind {
  const bind = value as SlotKeybind | null
  return (
    typeof bind?.code === 'string' &&
    typeof bind?.shift === 'boolean' &&
    typeof bind?.ctrl === 'boolean' &&
    typeof bind?.alt === 'boolean'
  )
}

export function loadKeybinds(storage: StorageLike = localStorage): (SlotKeybind | null)[] {
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) return [...DEFAULT_KEYBINDS]
    const parsed = JSON.parse(raw) as unknown[]
    if (!Array.isArray(parsed)) return [...DEFAULT_KEYBINDS]
    return Array.from({ length: HOTBAR_SIZE }, (_, i) => (isKeybind(parsed[i]) ? parsed[i] : null))
  } catch {
    return [...DEFAULT_KEYBINDS]
  }
}

export function saveKeybinds(
  binds: (SlotKeybind | null)[],
  storage: StorageLike = localStorage,
): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(binds.slice(0, HOTBAR_SIZE)))
  } catch {
    // 保存できなくてもセッション中は有効
  }
}

/** 表示用の短いラベル。例: '1' / 'S+Q' / 'C+A+X' / 'F5'。nullは空文字 */
export function formatKeybind(bind: SlotKeybind | null): string {
  if (!bind) return ''
  let key = bind.code
  if (key.startsWith('Digit')) key = key.slice(5)
  else if (key.startsWith('Key')) key = key.slice(3)
  else if (key.startsWith('Numpad')) key = `N${key.slice(6)}`
  else if (key === 'Space') key = 'Spc'
  const mods = `${bind.ctrl ? 'C+' : ''}${bind.alt ? 'A+' : ''}${bind.shift ? 'S+' : ''}`
  return mods + key
}

/** code一致かつ修飾3種の完全一致(Shift+1のバインドは素の1にマッチしない) */
export function matchKeybind(
  bind: SlotKeybind,
  ev: Pick<KeyboardEvent, 'code' | 'shiftKey' | 'ctrlKey' | 'altKey'>,
): boolean {
  return (
    bind.code === ev.code &&
    bind.shift === ev.shiftKey &&
    bind.ctrl === ev.ctrlKey &&
    bind.alt === ev.altKey
  )
}

export interface KeybindConflicts {
  /** 予約キーの用途名(衝突なしはnull)。修飾付きなら予約扱いしない */
  reserved: string | null
  /** 同じバインドを持つ他スロットのindex(なければnull) */
  slotIndex: number | null
}

export function findKeybindConflicts(
  binds: (SlotKeybind | null)[],
  index: number,
  candidate: SlotKeybind,
): KeybindConflicts {
  const noMods = !candidate.shift && !candidate.ctrl && !candidate.alt
  const reserved = noMods
    ? (RESERVED_KEYS.find((k) => k.code === candidate.code)?.label ?? null)
    : null
  const slotIndex = binds.findIndex(
    (bind, i) =>
      i !== index &&
      bind !== null &&
      bind.code === candidate.code &&
      bind.shift === candidate.shift &&
      bind.ctrl === candidate.ctrl &&
      bind.alt === candidate.alt,
  )
  return { reserved, slotIndex: slotIndex === -1 ? null : slotIndex }
}
