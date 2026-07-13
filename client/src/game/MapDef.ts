import { NavGrid } from './pathfinding'

export const MAP_SIZE = 60
export const NAV_CELL = 0.5
/** アバターの半径ぶん障害物を膨らませて経路に余白を持たせる */
const NAV_MARGIN = 0.35

export type Obstacle =
  | { kind: 'circle'; x: number; z: number; r: number }
  | { kind: 'rect'; x: number; z: number; w: number; d: number }
  | { kind: 'ellipse'; x: number; z: number; rx: number; rz: number }

export interface PropDef {
  x: number
  z: number
  scale: number
}

/** 池。地面テクスチャに直接描き込み、通行不可にする */
export const POND = { x: 10, z: 5, rx: 6, rz: 4.5 }

/** 生け垣。ブッシュのスプライトを並べて描画し、壁として通行を塞ぐ */
export const HEDGES: Array<{ x: number; z: number; w: number; d: number }> = [
  { x: -9, z: -4, w: 14, d: 1.2 },
  { x: 4, z: 12, w: 1.2, d: 10 },
]

export const TREES: PropDef[] = [
  { x: -14, z: 8, scale: 1.2 },
  { x: -20, z: -12, scale: 1.4 },
  { x: -4, z: -16, scale: 1.1 },
  { x: 12, z: -12, scale: 1.3 },
  { x: 20, z: -2, scale: 1.0 },
  { x: 18, z: 14, scale: 1.2 },
  { x: -22, z: 16, scale: 1.0 },
  { x: -2, z: 20, scale: 1.3 },
  { x: 8, z: -20, scale: 0.9 },
  { x: 24, z: -16, scale: 1.1 },
]

export const ROCKS: PropDef[] = [
  { x: -6, z: 4, scale: 1.2 },
  { x: 14, z: -4, scale: 0.9 },
  { x: -18, z: 0, scale: 1.0 },
  { x: 2, z: -8, scale: 0.8 },
  { x: -12, z: 18, scale: 1.4 },
  { x: 22, z: 6, scale: 1.0 },
]

export function getObstacles(margin = 0): Obstacle[] {
  return [
    { kind: 'ellipse', x: POND.x, z: POND.z, rx: POND.rx + margin, rz: POND.rz + margin },
    ...HEDGES.map(
      (h): Obstacle => ({
        kind: 'rect',
        x: h.x,
        z: h.z,
        w: h.w + margin * 2,
        d: h.d + margin * 2,
      }),
    ),
    ...TREES.map((t): Obstacle => ({ kind: 'circle', x: t.x, z: t.z, r: 0.55 * t.scale + margin })),
    ...ROCKS.map((r): Obstacle => ({ kind: 'circle', x: r.x, z: r.z, r: 0.7 * r.scale + margin })),
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
    (x, z) => Math.max(Math.abs(x), Math.abs(z)) > edge || hitsObstacle(x, z, obstacles),
  )
  return grid
}
