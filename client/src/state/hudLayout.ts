/**
 * HUD要素の配置の永続化。キーは要素ID('chat'/'status'/'hotbar-<seq>')で、
 * ホットバーが動的に増減するため固定リストでは絞らず値の形だけ検証する。
 * 位置が無い要素はCSSデフォルト位置(アンカー)。位置はビューポート左上からの
 * pxで保存し、描画時にクランプする(保存値自体は解像度変更で書き換えない)。
 */

export type HudElementId = string

export interface HudPosition {
  x: number
  y: number
}

export type HudLayout = Record<HudElementId, HudPosition>

/** 各HUD要素の表示/非表示(未記録は表示)。非表示要素はHUD編集モード中だけ半透明で見える */
export type HudVisibility = Record<HudElementId, boolean>

const STORAGE_KEY = 'avatarsquare:hudLayout'
const VISIBILITY_KEY = 'avatarsquare:hudVisibility'

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

function isPosition(value: unknown): value is HudPosition {
  const pos = value as HudPosition | null
  return typeof pos?.x === 'number' && typeof pos?.y === 'number'
}

/** 単一ホットバー時代のキー'hotbar'を'hotbar-0'に読み替える */
function migrateLegacyHotbarKey<T>(record: Record<string, T>): Record<string, T> {
  if ('hotbar' in record) {
    if (!('hotbar-0' in record)) record['hotbar-0'] = record.hotbar
    delete record.hotbar
  }
  return record
}

export function loadHudLayout(storage: StorageLike = localStorage): HudLayout {
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (typeof parsed !== 'object' || parsed === null) return {}
    const layout: HudLayout = {}
    for (const [id, value] of Object.entries(parsed)) {
      if (isPosition(value)) layout[id] = value
    }
    return migrateLegacyHotbarKey(layout)
  } catch {
    return {}
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
  try {
    const raw = storage.getItem(VISIBILITY_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (typeof parsed !== 'object' || parsed === null) return {}
    const visibility: HudVisibility = {}
    for (const [id, value] of Object.entries(parsed)) {
      if (typeof value === 'boolean') visibility[id] = value
    }
    return migrateLegacyHotbarKey(visibility)
  } catch {
    return {}
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
