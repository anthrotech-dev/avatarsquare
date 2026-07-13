import type { HotbarSlot } from '../../state/hotbar'

/**
 * pragmatic-drag-and-dropで運ぶデータの型。
 * dataはRecord<string, unknown>で渡ってくるため型ガードで絞る(公式レシピ準拠)。
 */

export interface PaletteItemData extends Record<string, unknown> {
  type: 'palette-item'
  slot: HotbarSlot
}

export interface HotbarSlotData extends Record<string, unknown> {
  type: 'hotbar-slot'
  /** ドラッグ元ホットバーのseq(ホットバー間の移動に対応) */
  seq: number
  index: number
  slot: HotbarSlot
}

function isSlot(value: unknown): value is HotbarSlot {
  const slot = value as HotbarSlot | null
  return typeof slot?.command === 'string' && typeof slot?.label === 'string'
}

export function isPaletteItemData(data: Record<string, unknown>): data is PaletteItemData {
  return data.type === 'palette-item' && isSlot(data.slot)
}

export function isHotbarSlotData(data: Record<string, unknown>): data is HotbarSlotData {
  return (
    data.type === 'hotbar-slot' &&
    typeof data.seq === 'number' &&
    typeof data.index === 'number' &&
    isSlot(data.slot)
  )
}
