import { NavGrid } from '../game/pathfinding'

/**
 * ワールド定義。サーバー(または自サイトのpublic)から取得するJSONで、
 * HTMLとJavaScriptの関係のように「シーン=汎用ノードの列」と
 * 「スクリプト=ノードをidで参照して操作するwasm(サーバー側で実行)」で構成される。
 * クライアントは専用のギミック型を持たず、ノードのkindを描画するだけ。
 */

export const NAV_CELL = 0.5
/** アバターの半径ぶん障害物を膨らませて経路に余白を持たせる */
const NAV_MARGIN = 0.35

/** ワールドid = LiveKitルーム名。サーバーの検証(nameRe)と同じ制約 */
export const WORLD_ID_RE = /^[A-Za-z0-9_-]{1,32}$/

export interface WorldSummary {
  id: string
  name: string
}

/**
 * シーンノード。既知の共通属性以外もそのまま保持する
 * (kindごとの属性はレンダラーが解釈し、未知の属性・kindは無視する)。
 * childrenでツリーにできる: 親=データを持つエンティティ、子=ビジュアル、が推奨規約。
 * targetable/collider/hp等のエンティティ属性はツリーのルートノードに置く。
 */
export interface SceneNode {
  id: string
  kind: string
  /** 座標は親相対(トップレベルはワールド座標) */
  x?: number
  z?: number
  y?: number
  visible?: boolean
  interactable?: boolean
  /** 選択(ターゲット)可能か */
  targetable?: boolean
  /** 表示名(ターゲットHUD等)。省略時はid */
  name?: string
  /** 公開HP。hpMaxと両方あればHUD等がゲージ表示する汎用規約 */
  hp?: number
  hpMax?: number
  /** 通行不可の足元半径(m)。省略時は通行可能な飾り */
  collider?: number
  /** 子ノード。idはツリー全体でグローバル一意 */
  children?: SceneNode[]
  [attr: string]: unknown
}

export interface WorldDef {
  version: number
  id: string
  name: string
  size: number
  spawn: { x: number; z: number }
  scene: SceneNode[]
  scripts: string[]
}

export type Obstacle =
  | { kind: 'circle'; x: number; z: number; r: number }
  | { kind: 'rect'; x: number; z: number; w: number; d: number }
  | { kind: 'polygon'; points: Array<[number, number]>; margin: number }

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/**
 * ワールドJSONの検証。壊れたワールドで画面が真っ黒になるより
 * 早めに例外で弾いてフォールバックに回す方針。ノード単位の未知kindは許容する。
 */
export function parseWorld(json: unknown): WorldDef {
  if (typeof json !== 'object' || json === null) throw new Error('ワールドJSONが不正です')
  const raw = json as Record<string, unknown>
  const id = String(raw.id ?? '')
  if (!WORLD_ID_RE.test(id)) throw new Error(`ワールドidが不正です: ${id}`)
  const size = num(raw.size)
  if (!size || size <= 0) throw new Error('sizeが不正です')
  const spawnRaw = (raw.spawn ?? {}) as Record<string, unknown>
  const spawn = { x: num(spawnRaw.x) ?? 0, z: num(spawnRaw.z) ?? 0 }
  if (!Array.isArray(raw.scene)) throw new Error('sceneがありません')

  // id重複・欠落はそのsubtreeごとスキップ(idはツリー全体で一意)
  const seen = new Set<string>()
  const parseNode = (node: unknown): SceneNode | null => {
    if (typeof node !== 'object' || node === null) return null
    const n = node as Record<string, unknown>
    const nodeId = String(n.id ?? '')
    const kind = String(n.kind ?? '')
    if (!nodeId || !kind || seen.has(nodeId)) return null
    seen.add(nodeId)
    const parsed: SceneNode = { ...n, id: nodeId, kind }
    if (Array.isArray(n.children)) {
      parsed.children = n.children.map(parseNode).filter((c): c is SceneNode => c !== null)
    } else {
      delete parsed.children
    }
    return parsed
  }
  const scene = raw.scene.map(parseNode).filter((n): n is SceneNode => n !== null)

  const scripts = Array.isArray(raw.scripts)
    ? raw.scripts.filter((s): s is string => typeof s === 'string')
    : []

  return {
    version: num(raw.version) ?? 1,
    id,
    name: typeof raw.name === 'string' && raw.name ? raw.name : id,
    size,
    spawn,
    scene,
    scripts,
  }
}

/** ワールドJSONのURLを基準に、アセットの相対URLを解決する */
export function resolveWorldUrl(worldUrl: string, asset: string): string {
  return new URL(asset, new URL(worldUrl, location.href)).toString()
}

/**
 * 通行不可領域。colliderノード(形状指定)と、collider属性(足元円)を持つノードから導出する。
 * 子ノードの座標は親相対なので、親チェーンのオフセットを合算してワールド座標にする
 */
export function getObstacles(world: WorldDef, margin = 0): Obstacle[] {
  const obstacles: Obstacle[] = []
  const visit = (node: SceneNode, ox: number, oz: number): void => {
    const x = (num(node.x) ?? 0) + ox
    const z = (num(node.z) ?? 0) + oz
    if (node.kind === 'collider') {
      const shape = String(node.shape ?? '')
      if (shape === 'circle') {
        const r = num(node.r)
        if (r !== undefined) obstacles.push({ kind: 'circle', x, z, r: r + margin })
      } else if (shape === 'rect') {
        const w = num(node.w)
        const d = num(node.d)
        if (w !== undefined && d !== undefined) {
          obstacles.push({ kind: 'rect', x, z, w: w + margin * 2, d: d + margin * 2 })
        }
      } else if (shape === 'polygon' && Array.isArray(node.points)) {
        const points = (node.points as unknown[])
          .map((p): [number, number] | null => {
            if (!Array.isArray(p)) return null
            const px = num(p[0])
            const pz = num(p[1])
            return px !== undefined && pz !== undefined ? [px + x, pz + z] : null
          })
          .filter((p): p is [number, number] => p !== null)
        if (points.length >= 3) obstacles.push({ kind: 'polygon', points, margin })
      }
    } else {
      const r = num(node.collider)
      if (r !== undefined && r > 0) obstacles.push({ kind: 'circle', x, z, r: r + margin })
    }
    for (const child of node.children ?? []) visit(child, x, z)
  }
  for (const node of world.scene) visit(node, 0, 0)
  return obstacles
}

export function hitsObstacle(x: number, z: number, obstacles: Obstacle[]): boolean {
  for (const o of obstacles) {
    switch (o.kind) {
      case 'circle': {
        const dx = x - o.x
        const dz = z - o.z
        if (dx * dx + dz * dz < o.r * o.r) return true
        break
      }
      case 'rect': {
        if (Math.abs(x - o.x) < o.w / 2 && Math.abs(z - o.z) < o.d / 2) return true
        break
      }
      case 'polygon': {
        if (pointInPolygon(x, z, o.points)) return true
        if (o.margin > 0 && distToPolygonEdge(x, z, o.points) < o.margin) return true
        break
      }
    }
  }
  return false
}

function pointInPolygon(x: number, z: number, points: Array<[number, number]>): boolean {
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, zi] = points[i]
    const [xj, zj] = points[j]
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside
  }
  return inside
}

function distToPolygonEdge(x: number, z: number, points: Array<[number, number]>): number {
  let min = Infinity
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    min = Math.min(min, distToSegment(x, z, points[j], points[i]))
  }
  return min
}

function distToSegment(x: number, z: number, a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  const lenSq = dx * dx + dz * dz
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / lenSq))
  return Math.hypot(x - (a[0] + t * dx), z - (a[1] + t * dz))
}

/** ワールドは接続中は静的なので、切替時に一度だけ構築する(事前計算) */
export function buildNavGrid(world: WorldDef): NavGrid {
  const grid = new NavGrid(world.size, NAV_CELL)
  const obstacles = getObstacles(world, NAV_MARGIN)
  const edge = world.size / 2 - 1
  grid.blockWhere(
    (x, z) => Math.max(Math.abs(x), Math.abs(z)) > edge || hitsObstacle(x, z, obstacles),
  )
  return grid
}
