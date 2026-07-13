export interface NavPoint {
  x: number
  z: number
}

const SQRT2 = Math.SQRT2

/**
 * 静的マップ用のグリッドナビゲーション。
 * 起動時に一度だけ構築し(事前計算)、以後はA* + 経路スムージングで経路を返す。
 * three.js非依存の純ロジック。
 */
export class NavGrid {
  readonly cols: number
  readonly rows: number
  /** 1 = 通行不可 */
  readonly blocked: Uint8Array

  constructor(
    readonly size: number,
    readonly cellSize: number,
  ) {
    this.cols = Math.round(size / cellSize)
    this.rows = Math.round(size / cellSize)
    this.blocked = new Uint8Array(this.cols * this.rows)
  }

  /** セル中心のワールド座標で判定する述語を受け取り、該当セルを塞ぐ */
  blockWhere(predicate: (x: number, z: number) => boolean): void {
    for (let cz = 0; cz < this.rows; cz++) {
      for (let cx = 0; cx < this.cols; cx++) {
        const { x, z } = this.cellCenter(cx, cz)
        if (predicate(x, z)) this.blocked[cz * this.cols + cx] = 1
      }
    }
  }

  worldToCell(x: number, z: number): [number, number] {
    const half = this.size / 2
    const cx = Math.min(this.cols - 1, Math.max(0, Math.floor((x + half) / this.cellSize)))
    const cz = Math.min(this.rows - 1, Math.max(0, Math.floor((z + half) / this.cellSize)))
    return [cx, cz]
  }

  cellCenter(cx: number, cz: number): NavPoint {
    const half = this.size / 2
    return {
      x: -half + (cx + 0.5) * this.cellSize,
      z: -half + (cz + 0.5) * this.cellSize,
    }
  }

  isWalkableCell(cx: number, cz: number): boolean {
    if (cx < 0 || cz < 0 || cx >= this.cols || cz >= this.rows) return false
    return this.blocked[cz * this.cols + cx] === 0
  }

  isWalkableAt(x: number, z: number): boolean {
    const [cx, cz] = this.worldToCell(x, z)
    return this.isWalkableCell(cx, cz)
  }

  /** 塞がれたセルを指定した場合に最寄りの通行可能セルを探す */
  nearestWalkable(cx: number, cz: number, maxRadius = 40): [number, number] | null {
    if (this.isWalkableCell(cx, cz)) return [cx, cz]
    for (let r = 1; r <= maxRadius; r++) {
      let best: [number, number] | null = null
      let bestDist = Infinity
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue
          const nx = cx + dx
          const nz = cz + dz
          if (!this.isWalkableCell(nx, nz)) continue
          const dist = dx * dx + dz * dz
          if (dist < bestDist) {
            bestDist = dist
            best = [nx, nz]
          }
        }
      }
      if (best) return best
    }
    return null
  }

  /**
   * ワールド座標間の経路を返す。到達不能ならnull。
   * 返り値は現在地を含まない中継地点列(最後の要素が目的地)。
   */
  findPath(from: NavPoint, to: NavPoint): NavPoint[] | null {
    const start = this.nearestWalkable(...this.worldToCell(from.x, from.z))
    const goal = this.nearestWalkable(...this.worldToCell(to.x, to.z))
    if (!start || !goal) return null

    const cells = this.aStar(start[0], start[1], goal[0], goal[1])
    if (!cells) return null

    const points: NavPoint[] = [
      { x: from.x, z: from.z },
      ...cells.map(([cx, cz]) => this.cellCenter(cx, cz)),
    ]
    // クリック地点自体が通行可能ならセル中心ではなく正確な地点まで歩く
    if (this.isWalkableAt(to.x, to.z)) points.push({ x: to.x, z: to.z })

    const smoothed = this.smooth(points)
    smoothed.shift() // 先頭は現在地
    return smoothed
  }

  hasLineOfSight(a: NavPoint, b: NavPoint): boolean {
    const dx = b.x - a.x
    const dz = b.z - a.z
    const dist = Math.hypot(dx, dz)
    const steps = Math.max(1, Math.ceil(dist / (this.cellSize * 0.5)))
    for (let i = 1; i <= steps; i++) {
      const t = i / steps
      if (!this.isWalkableAt(a.x + dx * t, a.z + dz * t)) return false
    }
    return true
  }

  /** 見通しの利く区間を直線に置き換えて経路を自然にする */
  private smooth(points: NavPoint[]): NavPoint[] {
    if (points.length <= 2) return points.slice()
    const out: NavPoint[] = [points[0]]
    let i = 0
    while (i < points.length - 1) {
      let k = points.length - 1
      while (k > i + 1 && !this.hasLineOfSight(points[i], points[k])) k--
      out.push(points[k])
      i = k
    }
    return out
  }

  private aStar(sx: number, sz: number, gx: number, gz: number): Array<[number, number]> | null {
    const { cols, rows } = this
    const total = cols * rows
    const gScore = new Float64Array(total).fill(Infinity)
    const cameFrom = new Int32Array(total).fill(-1)
    const closed = new Uint8Array(total)

    const heap = new MinHeap()
    const startId = sz * cols + sx
    const goalId = gz * cols + gx
    gScore[startId] = 0
    heap.push(startId, octile(sx, sz, gx, gz))

    while (heap.size > 0) {
      const current = heap.pop()
      if (current === goalId) return this.reconstruct(cameFrom, current)
      if (closed[current]) continue
      closed[current] = 1

      const cx = current % cols
      const cz = Math.floor(current / cols)
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dz === 0) continue
          const nx = cx + dx
          const nz = cz + dz
          if (!this.isWalkableCell(nx, nz)) continue
          // 斜め移動は両隣が空いている場合のみ(角の突き抜け防止)
          if (dx !== 0 && dz !== 0) {
            if (!this.isWalkableCell(cx + dx, cz) || !this.isWalkableCell(cx, cz + dz)) continue
          }
          const neighbor = nz * cols + nx
          if (closed[neighbor]) continue
          const cost = dx !== 0 && dz !== 0 ? SQRT2 : 1
          const tentative = gScore[current] + cost
          if (tentative < gScore[neighbor]) {
            gScore[neighbor] = tentative
            cameFrom[neighbor] = current
            heap.push(neighbor, tentative + octile(nx, nz, gx, gz))
          }
        }
      }
    }
    return null
  }

  private reconstruct(cameFrom: Int32Array, goalId: number): Array<[number, number]> {
    const cells: Array<[number, number]> = []
    let id = goalId
    while (id !== -1) {
      cells.push([id % this.cols, Math.floor(id / this.cols)])
      id = cameFrom[id]
    }
    return cells.reverse()
  }
}

function octile(x0: number, z0: number, x1: number, z1: number): number {
  const dx = Math.abs(x1 - x0)
  const dz = Math.abs(z1 - z0)
  return Math.max(dx, dz) + (SQRT2 - 1) * Math.min(dx, dz)
}

class MinHeap {
  private ids: number[] = []
  private priorities: number[] = []

  get size(): number {
    return this.ids.length
  }

  push(id: number, priority: number): void {
    this.ids.push(id)
    this.priorities.push(priority)
    let i = this.ids.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (this.priorities[parent] <= this.priorities[i]) break
      this.swap(i, parent)
      i = parent
    }
  }

  pop(): number {
    const top = this.ids[0]
    const lastId = this.ids.pop()
    const lastPriority = this.priorities.pop()
    if (this.ids.length > 0 && lastId !== undefined && lastPriority !== undefined) {
      this.ids[0] = lastId
      this.priorities[0] = lastPriority
      let i = 0
      for (;;) {
        const left = i * 2 + 1
        const right = i * 2 + 2
        let smallest = i
        if (left < this.ids.length && this.priorities[left] < this.priorities[smallest]) {
          smallest = left
        }
        if (right < this.ids.length && this.priorities[right] < this.priorities[smallest]) {
          smallest = right
        }
        if (smallest === i) break
        this.swap(i, smallest)
        i = smallest
      }
    }
    return top
  }

  private swap(a: number, b: number): void {
    ;[this.ids[a], this.ids[b]] = [this.ids[b], this.ids[a]]
    ;[this.priorities[a], this.priorities[b]] = [this.priorities[b], this.priorities[a]]
  }
}
