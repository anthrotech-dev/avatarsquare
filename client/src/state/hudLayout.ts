/**
 * HUD要素の配置の永続化。null = CSSデフォルト位置(アンカー)。
 * 位置はビューポート左上からのpxで保存し、描画時にクランプする
 * (保存値自体は解像度変更で書き換えない)。
 */

export type HudElementId = 'hotbar' | 'chat' | 'status' | 'settings'

export interface HudPosition {
  x: number
  y: number
}

export type HudLayout = Record<HudElementId, HudPosition | null>

/** 各HUD要素の表示/非表示。非表示要素はHUD編集モード中だけ半透明で見える */
export type HudVisibility = Record<HudElementId, boolean>

export const HUD_ELEMENT_IDS: HudElementId[] = ['hotbar', 'chat', 'status', 'settings']

export const DEFAULT_HUD_LAYOUT: HudLayout = {
  hotbar: null,
  chat: null,
  status: null,
  settings: null,
}

export const DEFAULT_HUD_VISIBILITY: HudVisibility = {
  hotbar: true,
  chat: true,
  status: true,
  settings: true,
}

const STORAGE_KEY = 'avatarsquare:hudLayout'
const VISIBILITY_KEY = 'avatarsquare:hudVisibility'

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

function isPosition(value: unknown): value is HudPosition {
  const pos = value as HudPosition | null
  return typeof pos?.x === 'number' && typeof pos?.y === 'number'
}

export function loadHudLayout(storage: StorageLike = localStorage): HudLayout {
  const layout: HudLayout = { ...DEFAULT_HUD_LAYOUT }
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) return layout
    const parsed = JSON.parse(raw) as Record<string, unknown>
    for (const id of HUD_ELEMENT_IDS) {
      if (isPosition(parsed?.[id])) layout[id] = parsed[id] as HudPosition
    }
    return layout
  } catch {
    return layout
  }
}

export function saveHudLayout(layout: HudLayout, storage: StorageLike = localStorage): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(layout))
  } catch {
    // 保存できなくてもセッション中は有効
  }
}

export function loadHudVisibility(storage: StorageLike = localStorage): HudVisibility {
  const visibility: HudVisibility = { ...DEFAULT_HUD_VISIBILITY }
  try {
    const raw = storage.getItem(VISIBILITY_KEY)
    if (!raw) return visibility
    const parsed = JSON.parse(raw) as Record<string, unknown>
    for (const id of HUD_ELEMENT_IDS) {
      if (typeof parsed?.[id] === 'boolean') visibility[id] = parsed[id] as boolean
    }
    return visibility
  } catch {
    return visibility
  }
}

export function saveHudVisibility(
  visibility: HudVisibility,
  storage: StorageLike = localStorage,
): void {
  try {
    storage.setItem(VISIBILITY_KEY, JSON.stringify(visibility))
  } catch {
    // 保存できなくてもセッション中は有効
  }
}

/** 要素の掴める部分が最低限ビューポート内に残るよう位置を補正する */
export function clampHudPosition(
  pos: HudPosition,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
): HudPosition {
  const margin = 24 // 最低これだけは画面内に見える
  const minX = Math.min(0, margin - size.width)
  const maxX = Math.max(0, viewport.width - margin)
  const minY = 0 // 上には見切れさせない(タイトル/ハンドルが掴めなくなる)
  const maxY = Math.max(0, viewport.height - margin)
  return {
    x: Math.min(Math.max(pos.x, minX), maxX),
    y: Math.min(Math.max(pos.y, minY), maxY),
  }
}
