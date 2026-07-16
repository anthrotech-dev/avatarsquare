/**
 * HUD要素の配置の永続化。キーは要素ID('chat'/'status'/'hotbar-<seq>')で、
 * ホットバーが動的に増減するため固定リストでは絞らず値の形だけ検証する。
 * 配置が無い要素はCSSデフォルト位置(アンカー)。
 *
 * 配置は9アンカー(左/中央/右 × 上/中/下)基準のオフセットで保存し、
 * ウィンドウリサイズ時も基準コーナーからの相対位置を保つ。
 * 旧形式(anchorなしの{x,y}=左上からのpx)は読込時にtop-leftへ読み替える。
 * クランプは描画時に適用する(保存値自体は解像度変更で書き換えない)。
 */

export type HudElementId = string

export interface HudPosition {
  x: number
  y: number
}

export type HudAnchorH = 'left' | 'center' | 'right'
export type HudAnchorV = 'top' | 'middle' | 'bottom'

export interface HudAnchor {
  h: HudAnchorH
  v: HudAnchorV
}

export interface HudPlacement {
  anchor: HudAnchor
  /** h=left: 左端からの距離 / right: 右端からの距離 / center: 中心からの符号付き距離(+で右) */
  x: number
  /** v=top: 上端からの距離 / bottom: 下端からの距離 / middle: 中心からの符号付き距離(+で下) */
  y: number
}

export type HudLayout = Record<HudElementId, HudPlacement>

/** 各HUD要素の表示/非表示(未記録は表示)。非表示要素はHUD編集モード中だけ半透明で見える */
export type HudVisibility = Record<HudElementId, boolean>

interface Size {
  width: number
  height: number
}

const STORAGE_KEY = 'avatarsquare:hudLayout'
const VISIBILITY_KEY = 'avatarsquare:hudVisibility'

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

const ANCHOR_H: readonly HudAnchorH[] = ['left', 'center', 'right']
const ANCHOR_V: readonly HudAnchorV[] = ['top', 'middle', 'bottom']

/** 保存値1件を検証する。anchorが無い旧形式({x,y}=左上px)はtop-leftへ読み替える */
function parsePlacement(value: unknown): HudPlacement | null {
  const raw = value as { x?: unknown; y?: unknown; anchor?: unknown } | null
  if (typeof raw?.x !== 'number' || typeof raw?.y !== 'number') return null
  if (raw.anchor === undefined) {
    return { anchor: { h: 'left', v: 'top' }, x: raw.x, y: raw.y }
  }
  const anchor = raw.anchor as { h?: unknown; v?: unknown }
  if (!ANCHOR_H.includes(anchor?.h as HudAnchorH) || !ANCHOR_V.includes(anchor?.v as HudAnchorV)) {
    return null
  }
  return { anchor: { h: anchor.h as HudAnchorH, v: anchor.v as HudAnchorV }, x: raw.x, y: raw.y }
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
      const placement = parsePlacement(value)
      if (placement) layout[id] = placement
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
export function clampHudPosition(pos: HudPosition, size: Size, viewport: Size): HudPosition {
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

/** placement → 現在のviewport/要素サイズでのleft/top(px) */
export function placementToTopLeft(p: HudPlacement, size: Size, viewport: Size): HudPosition {
  const x =
    p.anchor.h === 'left'
      ? p.x
      : p.anchor.h === 'right'
        ? viewport.width - p.x - size.width
        : viewport.width / 2 + p.x - size.width / 2
  const y =
    p.anchor.v === 'top'
      ? p.y
      : p.anchor.v === 'bottom'
        ? viewport.height - p.y - size.height
        : viewport.height / 2 + p.y - size.height / 2
  return { x, y }
}

/** left/top(px) → 指定アンカー基準のオフセット(placementToTopLeftの逆関数) */
export function topLeftToPlacement(
  pos: HudPosition,
  anchor: HudAnchor,
  size: Size,
  viewport: Size,
): HudPlacement {
  const x =
    anchor.h === 'left'
      ? pos.x
      : anchor.h === 'right'
        ? viewport.width - pos.x - size.width
        : pos.x + size.width / 2 - viewport.width / 2
  const y =
    anchor.v === 'top'
      ? pos.y
      : anchor.v === 'bottom'
        ? viewport.height - pos.y - size.height
        : pos.y + size.height / 2 - viewport.height / 2
  return { anchor, x, y }
}

/** アンカーを保ったまま、掴める部分が画面内に残るようオフセットを補正する */
export function clampHudPlacement(p: HudPlacement, size: Size, viewport: Size): HudPlacement {
  const clamped = clampHudPosition(placementToTopLeft(p, size, viewport), size, viewport)
  return topLeftToPlacement(clamped, p.anchor, size, viewport)
}

/**
 * placement → inline style。left/right/bottom/calcを使い分け、再レンダー間も
 * ブラウザがリサイズに追従する形で返す。center/middleはビューポート中心に
 * 要素中心を合わせるためtransformを併用する(CSSデフォルトのtranslateX(-50%)を
 * 上書きできるようtransformは常に返す)。
 */
export function placementToStyle(p: HudPlacement): {
  left: number | string
  right: number | string
  top: number | string
  bottom: number | string
  transform: string
} {
  const tx = p.anchor.h === 'center' ? '-50%' : '0px'
  const ty = p.anchor.v === 'middle' ? '-50%' : '0px'
  return {
    left: p.anchor.h === 'left' ? p.x : p.anchor.h === 'center' ? `calc(50% + ${p.x}px)` : 'auto',
    right: p.anchor.h === 'right' ? p.x : 'auto',
    top: p.anchor.v === 'top' ? p.y : p.anchor.v === 'middle' ? `calc(50% + ${p.y}px)` : 'auto',
    bottom: p.anchor.v === 'bottom' ? p.y : 'auto',
    transform: tx === '0px' && ty === '0px' ? 'none' : `translate(${tx}, ${ty})`,
  }
}
