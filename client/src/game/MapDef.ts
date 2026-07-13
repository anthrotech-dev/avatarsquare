import { NavGrid } from './pathfinding'

export const MAP_SIZE = 60
export const NAV_CELL = 0.5
/** アバターの半径ぶん障害物を膨らませて経路に余白を持たせる */
const NAV_MARGIN = 0.35

/**
 * マップ構成: 中央にレンガ敷きの広場(噴水付き)、西〜南に草原、
 * 北に森、東に砂浜と海がコンパクトにまとまっている。
 */

/** アバターの初期位置(広場内、噴水を避けた位置) */
export const SPAWN = { x: 3, z: 5 }

/** 中央のレンガ敷き広場 */
export const PLAZA = { x: 0, z: 0, r: 11 }

/** 広場中央の噴水(通行不可) */
export const FOUNTAIN = { x: 0, z: 0, r: 2.4 }

/** このzより北側は森(見た目のゾーン。通行は木の間なら可能) */
export const FOREST_Z = -13

/** 海岸線。このxより東は海(通行不可)。砂浜はこの手前4.5ユニット */
export function coastX(z: number): number {
  return 17 + 2.5 * Math.sin(z * 0.11)
}
export const BEACH_WIDTH = 4.5

export type Obstacle =
  | { kind: 'circle'; x: number; z: number; r: number }
  | { kind: 'rect'; x: number; z: number; w: number; d: number }
  | { kind: 'ellipse'; x: number; z: number; rx: number; rz: number }

export interface PropDef {
  x: number
  z: number
  scale: number
}

export type TreeKind = 'oak' | 'broad' | 'pine' | 'palm' | 'autumn'
export type RockKind = 'brown' | 'gray'

export const TREES: Array<PropDef & { kind: TreeKind }> = [
  // 北の森(針葉樹)
  { x: -22, z: -16, scale: 1.3, kind: 'pine' },
  { x: -18, z: -21, scale: 1.1, kind: 'pine' },
  { x: -13, z: -17, scale: 1.4, kind: 'pine' },
  { x: -9, z: -22, scale: 1.2, kind: 'pine' },
  { x: -4, z: -16, scale: 1.3, kind: 'pine' },
  { x: 1, z: -21, scale: 1.1, kind: 'pine' },
  { x: 6, z: -17, scale: 1.2, kind: 'pine' },
  { x: 10, z: -23, scale: 1.0, kind: 'pine' },
  { x: -20, z: -26, scale: 1.2, kind: 'pine' },
  { x: -14, z: -25, scale: 1.0, kind: 'pine' },
  { x: -7, z: -27, scale: 1.3, kind: 'pine' },
  { x: 0, z: -26, scale: 1.2, kind: 'pine' },
  { x: -25, z: -22, scale: 1.0, kind: 'pine' },
  { x: 5, z: -26, scale: 1.4, kind: 'pine' },
  // 森の入り口の広葉樹と紅葉
  { x: -17, z: -14, scale: 0.9, kind: 'oak' },
  { x: 2, z: -14, scale: 0.9, kind: 'autumn' },
  // 草原に点在する広葉樹
  { x: -24, z: 6, scale: 1.2, kind: 'oak' },
  { x: -18, z: 14, scale: 1.0, kind: 'broad' },
  { x: -25, z: 22, scale: 1.3, kind: 'oak' },
  { x: -12, z: 24, scale: 1.1, kind: 'autumn' },
  { x: -3, z: 20, scale: 1.0, kind: 'broad' },
  { x: 8, z: 22, scale: 1.2, kind: 'oak' },
  { x: 14, z: 12, scale: 0.9, kind: 'broad' },
  { x: 9, z: -9, scale: 1.0, kind: 'oak' },
  // 砂浜のヤシ
  { x: 16, z: 7, scale: 1.2, kind: 'palm' },
  { x: 13, z: -16, scale: 1.0, kind: 'palm' },
  { x: 17, z: 12, scale: 1.1, kind: 'palm' },
]

export const ROCKS: Array<PropDef & { kind: RockKind }> = [
  { x: 12, z: -14, scale: 0.9, kind: 'gray' }, // 砂浜の岩
  { x: -20, z: -8, scale: 1.2, kind: 'brown' },
  { x: 12, z: 16, scale: 0.8, kind: 'brown' },
  { x: -15, z: 3, scale: 1.0, kind: 'gray' },
]

/** 広場の縁を飾るブッシュ(東と南西の出入り口は空けてある) */
export const BUSHES: PropDef[] = [
  { x: 9.2, z: 7.7, scale: 1.0 },
  { x: 0, z: 12, scale: 1.1 },
  { x: -12, z: 0, scale: 1.0 },
  { x: -9.2, z: -7.7, scale: 1.0 },
  { x: -4.1, z: -11.3, scale: 1.1 },
  { x: 4.1, z: -11.3, scale: 1.0 },
  { x: 9.2, z: -7.7, scale: 1.1 },
]

export function getObstacles(margin = 0): Obstacle[] {
  return [
    { kind: 'circle', x: FOUNTAIN.x, z: FOUNTAIN.z, r: FOUNTAIN.r + margin },
    ...TREES.map((t): Obstacle => ({ kind: 'circle', x: t.x, z: t.z, r: 0.55 * t.scale + margin })),
    ...ROCKS.map((r): Obstacle => ({ kind: 'circle', x: r.x, z: r.z, r: 0.7 * r.scale + margin })),
    ...BUSHES.map((b): Obstacle => ({ kind: 'circle', x: b.x, z: b.z, r: 0.6 * b.scale + margin })),
  ]
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
      case 'ellipse': {
        const nx = (x - o.x) / o.rx
        const nz = (z - o.z) / o.rz
        if (nx * nx + nz * nz < 1) return true
        break
      }
    }
  }
  return false
}

/** マップは静的なので起動時に一度だけ構築する(事前計算) */
export function buildNavGrid(): NavGrid {
  const grid = new NavGrid(MAP_SIZE, NAV_CELL)
  const obstacles = getObstacles(NAV_MARGIN)
  const edge = MAP_SIZE / 2 - 1
  grid.blockWhere(
    (x, z) =>
      Math.max(Math.abs(x), Math.abs(z)) > edge ||
      x > coastX(z) - 0.3 || // 海
      hitsObstacle(x, z, obstacles),
  )
  return grid
}
