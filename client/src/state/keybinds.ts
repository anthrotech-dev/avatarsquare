/**
 * ホットバー各スロットのキーバインド。任意キー+Shift/Ctrl/Alt修飾に対応する。
 * KeyboardEvent.code ベース(レイアウト非依存)。
 */

export interface SlotKeybind {
  code: string
  shift: boolean
  ctrl: boolean
  alt: boolean
}

/** ゲーム側で固定用途に使っているキー。修飾なしで割り当てると衝突警告を出す */
export const RESERVED_KEYS: Array<{ code: string; label: string }> = [
  { code: 'Escape', label: 'キャンセル操作' },
]

const plain = (code: string): SlotKeybind => ({ code, shift: false, ctrl: false, alt: false })

/** 12スロット分。数字列1〜9,0のあとはSpace(ジャンプ)とEnter(チャット入力)が入る */
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
  plain('Space'),
  plain('Enter'),
]

export function isKeybind(value: unknown): value is SlotKeybind {
  const bind = value as SlotKeybind | null
  return (
    typeof bind?.code === 'string' &&
    typeof bind?.shift === 'boolean' &&
    typeof bind?.ctrl === 'boolean' &&
    typeof bind?.alt === 'boolean'
  )
}

/** 表示用の短いラベル。例: '1' / 'S+Q' / 'C+A+X' / 'F5'。nullは空文字 */
export function formatKeybind(bind: SlotKeybind | null): string {
  if (!bind) return ''
  let key = bind.code
  if (key.startsWith('Digit')) key = key.slice(5)
  else if (key.startsWith('Key')) key = key.slice(3)
  else if (key.startsWith('Numpad')) key = `N${key.slice(6)}`
  else if (key === 'Space') key = 'Spc'
  else if (key === 'Enter') key = 'Ent'
  else if (key === 'Minus') key = '-'
  else if (key === 'Equal') key = '^'
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
  /** 同じバインドを持つ他スロット(なければnull)。ホットバー横断で調べる */
  conflict: { seq: number; index: number } | null
}

export function findKeybindConflicts(
  hotbars: Array<{ seq: number; keys: (SlotKeybind | null)[] }>,
  target: { seq: number; index: number },
  candidate: SlotKeybind,
): KeybindConflicts {
  const noMods = !candidate.shift && !candidate.ctrl && !candidate.alt
  const reserved = noMods
    ? (RESERVED_KEYS.find((k) => k.code === candidate.code)?.label ?? null)
    : null
  for (const hotbar of hotbars) {
    const index = hotbar.keys.findIndex(
      (bind, i) =>
        !(hotbar.seq === target.seq && i === target.index) &&
        bind !== null &&
        bind.code === candidate.code &&
        bind.shift === candidate.shift &&
        bind.ctrl === candidate.ctrl &&
        bind.alt === candidate.alt,
    )
    if (index !== -1) return { reserved, conflict: { seq: hotbar.seq, index } }
  }
  return { reserved, conflict: null }
}
