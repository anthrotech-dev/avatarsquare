/**
 * islandワールド(南の小島)の生成器(開発用)。
 * generate-squareと同じ方式: vite devでこのページを開き、Playwright等から
 * window.__generate() を呼んで public/worlds/island.json と
 * public/worlds/island/ground.webp、共有のポータル画像 public/worlds/portal.png を書き出す。
 * 以後は生成物がワールドの正本になる(ランタイムは生成コードを持たない)。
 */

const MAP_SIZE = 60
const TEX_SIZE = 2048

const SPAWN = { x: 0, z: 2 }

/**
 * 島の海岸線(角度依存の揺らぎつき半径)。
 * 通行判定のキーホールポリゴンと地面テクスチャの両方がこの関数から作られる
 */
function islandR(theta: number): number {
  return 15 + 2.5 * Math.sin(3 * theta) + 1.5 * Math.sin(7 * theta + 1)
}

/** 中央の草地パッチの半径 */
function grassR(theta: number): number {
  return 7 + 1.4 * Math.sin(2 * theta + 2) + 0.9 * Math.sin(5 * theta)
}

// ---------------------------------------------------------------------------
// 描画ヘルパ(generate-squareと同じ座標系)
// ---------------------------------------------------------------------------

function worldToPx(v: number): number {
  return ((v + MAP_SIZE / 2) / MAP_SIZE) * TEX_SIZE
}

function unitToPx(v: number): number {
  return (v / MAP_SIZE) * TEX_SIZE
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`failed to load ${url}`))
    img.src = url
  })
}

function makePattern(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  worldTile: number,
): CanvasPattern {
  const pattern = ctx.createPattern(img, 'repeat')
  if (!pattern) throw new Error('pattern unavailable')
  const scale = unitToPx(worldTile) / img.width
  pattern.setTransform(new DOMMatrix().scale(scale))
  return pattern
}

/** 半径関数r(θ)の閉パスを描く(offsetで内外に平行移動) */
function radialPath(
  ctx: CanvasRenderingContext2D,
  radius: (theta: number) => number,
  offset: number,
): void {
  ctx.beginPath()
  const steps = 180
  for (let i = 0; i <= steps; i++) {
    const theta = (i / steps) * Math.PI * 2
    const r = radius(theta) + offset
    const px = worldToPx(Math.cos(theta) * r)
    const py = worldToPx(Math.sin(theta) * r)
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.closePath()
}

// ---------------------------------------------------------------------------
// 地面テクスチャ
// ---------------------------------------------------------------------------

interface GroundImages {
  grass: HTMLImageElement
  sand: HTMLImageElement
}

function paintGround(ctx: CanvasRenderingContext2D, images: GroundImages): void {
  const sandPattern = makePattern(ctx, images.sand, 6)
  const grassPattern = makePattern(ctx, images.grass, 7)

  // 海: 島に近いほど浅い放射グラデーション(色はsquareの海と揃える)
  const sea = ctx.createRadialGradient(
    TEX_SIZE / 2,
    TEX_SIZE / 2,
    unitToPx(15),
    TEX_SIZE / 2,
    TEX_SIZE / 2,
    TEX_SIZE * 0.72,
  )
  sea.addColorStop(0, '#7fc5de')
  sea.addColorStop(0.35, '#4f9cc4')
  sea.addColorStop(1, '#2c6c96')
  ctx.fillStyle = sea
  ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE)

  // 浅瀬(島のまわりをひとまわり明るく)
  radialPath(ctx, islandR, 2.2)
  ctx.fillStyle = 'rgba(190, 228, 240, 0.5)'
  ctx.fill()

  // 島の砂地
  radialPath(ctx, islandR, 0)
  ctx.fillStyle = sandPattern
  ctx.fill()

  // 砂のまだら(素材の継ぎ目をごまかす。島の範囲だけにクリップ)
  ctx.save()
  radialPath(ctx, islandR, 0)
  ctx.clip()
  for (let i = 0; i < 900; i++) {
    const x = Math.random() * TEX_SIZE
    const y = Math.random() * TEX_SIZE
    const r = 3 + Math.random() * 12
    ctx.fillStyle = Math.random() < 0.5 ? 'rgba(160, 130, 90, 0.08)' : 'rgba(240, 225, 190, 0.10)'
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()

  // 中央の草地パッチ+縁のぼかし
  radialPath(ctx, grassR, 0)
  ctx.fillStyle = grassPattern
  ctx.fill()
  radialPath(ctx, grassR, 0)
  ctx.strokeStyle = 'rgba(122, 168, 96, 0.55)'
  ctx.lineWidth = unitToPx(0.8)
  ctx.stroke()

  // 濡れた砂と波の泡(海岸線に沿って)
  ctx.strokeStyle = 'rgba(166, 138, 105, 0.5)'
  ctx.lineWidth = unitToPx(0.7)
  radialPath(ctx, islandR, -0.4)
  ctx.stroke()
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)'
  ctx.lineWidth = unitToPx(0.35)
  radialPath(ctx, islandR, 0)
  ctx.stroke()
  ctx.setLineDash([unitToPx(2.6), unitToPx(1.8)])
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)'
  radialPath(ctx, islandR, 1.2)
  ctx.stroke()
  ctx.setLineDash([unitToPx(2), unitToPx(2.6)])
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)'
  radialPath(ctx, islandR, 2.4)
  ctx.stroke()
  ctx.setLineDash([])

  // マップ外周を暗くする(squareと同じ演出)
  const edge = ctx.createRadialGradient(
    TEX_SIZE / 2,
    TEX_SIZE / 2,
    TEX_SIZE * 0.42,
    TEX_SIZE / 2,
    TEX_SIZE / 2,
    TEX_SIZE * 0.74,
  )
  edge.addColorStop(0, 'rgba(12, 32, 48, 0)')
  edge.addColorStop(1, 'rgba(12, 32, 48, 0.38)')
  ctx.fillStyle = edge
  ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE)
}

// ---------------------------------------------------------------------------
// ポータル画像(ワールド間で共有: /worlds/portal.png)
// ---------------------------------------------------------------------------

function paintPortal(): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = 192
  canvas.height = 256
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2d context unavailable')
  const w = canvas.width
  const h = canvas.height
  const cx = w / 2
  const cy = h * 0.44

  // 石のアーチ
  ctx.strokeStyle = '#8d939e'
  ctx.lineWidth = 14
  ctx.beginPath()
  ctx.ellipse(cx, cy, w * 0.34, h * 0.4, 0, 0, Math.PI * 2)
  ctx.stroke()
  ctx.strokeStyle = '#5f646d'
  ctx.lineWidth = 4
  ctx.beginPath()
  ctx.ellipse(cx, cy, w * 0.38, h * 0.44, 0, 0, Math.PI * 2)
  ctx.stroke()

  // 渦(内側ほど明るい青緑の帯)
  const swirl = ctx.createRadialGradient(cx, cy, 4, cx, cy, w * 0.32)
  swirl.addColorStop(0, '#e8fff9')
  swirl.addColorStop(0.45, '#54e0c0')
  swirl.addColorStop(1, '#1a7fa8')
  ctx.fillStyle = swirl
  ctx.beginPath()
  ctx.ellipse(cx, cy, w * 0.3, h * 0.36, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)'
  ctx.lineWidth = 5
  for (let i = 0; i < 3; i++) {
    ctx.beginPath()
    for (let t = 0; t <= 1; t += 0.02) {
      const angle = t * Math.PI * 3 + (i * Math.PI * 2) / 3
      const r = t * w * 0.27
      const px = cx + Math.cos(angle) * r
      const py = cy + Math.sin(angle) * r * (h / w) * 0.9
      if (t === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    }
    ctx.stroke()
  }

  // 足元の台座
  ctx.fillStyle = '#9a948a'
  ctx.beginPath()
  ctx.ellipse(cx, h * 0.93, w * 0.42, h * 0.06, 0, 0, Math.PI * 2)
  ctx.fill()
  return canvas
}

// ---------------------------------------------------------------------------
// ワールドJSON
// ---------------------------------------------------------------------------

function round(v: number): number {
  return Math.round(v * 1000) / 1000
}

/**
 * 海の通行不可領域: マップ全体を覆い、島だけをくり抜いたキーホールポリゴン。
 * 外周(時計回り)→切れ込み→島の海岸線(逆回り)→切れ込みを戻る、の一筆書き。
 * hitsObstacleの交差数判定(point-in-polygon)は穴あき形状をそのまま扱える。
 */
function seaPolygon(): [number, number][] {
  const half = MAP_SIZE / 2 + 5
  const points: [number, number][] = [
    [half, 0], // 切れ込みの起点(外周の東)
    [half, half],
    [-half, half],
    [-half, -half],
    [half, -half],
    [half, 0], // 外周を一周して戻る
  ]
  // 切れ込み: 東の外周から島の海岸線へ(θ=0)
  const steps = 180
  for (let i = 0; i <= steps; i++) {
    // 外周が時計回り相当なので、島は逆回りにたどって「穴」にする
    const theta = -(i / steps) * Math.PI * 2
    const r = islandR(theta) - 0.3
    points.push([round(Math.cos(theta) * r), round(Math.sin(theta) * r)])
  }
  points.push([half, 0]) // 切れ込みを戻って閉じる
  return points
}

/** 各素材の寸法(generate-squareと同じ係数) */
const PALM = { url: '/sprites/tree-palm.png', w: 2.2, h: 3.7, collider: 0.55 }
const ROCK = { gray: { url: '/sprites/rock-gray.png', w: 1.35, h: 0.85 }, collider: 0.7 }
const BUSH = { url: '/sprites/tree-bush.png', w: 1.15, h: 1.9, collider: 0.6 }

function buildWorldJson(): string {
  const scene: Record<string, unknown>[] = [
    { id: 'ground', kind: 'ground', texture: 'island/ground.webp' },
    { id: 'sea', kind: 'collider', shape: 'polygon', points: seaPolygon() },
  ]

  const palms: Array<{ x: number; z: number; scale: number }> = [
    { x: -9, z: -8, scale: 1.2 },
    { x: 8, z: -10, scale: 1.0 },
    { x: 12, z: 3, scale: 1.3 },
    { x: -12, z: 5, scale: 1.1 },
    { x: -4, z: 11, scale: 1.0 },
    { x: 6, z: 9, scale: 1.2 },
  ]
  palms.forEach((p, i) => {
    scene.push({
      id: `palm-${i + 1}`,
      kind: 'sprite',
      image: PALM.url,
      x: p.x,
      z: p.z,
      w: round(PALM.w * p.scale),
      h: round(PALM.h * p.scale),
      collider: round(PALM.collider * p.scale),
    })
  })
  const rocks: Array<{ x: number; z: number; scale: number }> = [
    { x: 3, z: -12, scale: 1.0 },
    { x: -13, z: -2, scale: 0.8 },
    { x: 10, z: 12, scale: 0.9 },
  ]
  rocks.forEach((r, i) => {
    scene.push({
      id: `rock-${i + 1}`,
      kind: 'sprite',
      image: ROCK.gray.url,
      x: r.x,
      z: r.z,
      w: round(ROCK.gray.w * r.scale),
      h: round(ROCK.gray.h * r.scale),
      collider: round(ROCK.collider * r.scale),
    })
  })
  scene.push(
    {
      id: 'bush-1',
      kind: 'sprite',
      image: BUSH.url,
      x: -2,
      z: -6,
      w: BUSH.w,
      h: BUSH.h,
      collider: BUSH.collider,
    },
    {
      id: 'bush-2',
      kind: 'sprite',
      image: BUSH.url,
      x: 4,
      z: 5,
      w: BUSH.w,
      h: BUSH.h,
      collider: BUSH.collider,
    },
  )

  // かかし(squareと同じwasm・同じツリー構造を流用。同じスクリプトが複数ワールドで動く)
  scene.push({
    id: 'scarecrow',
    kind: 'group',
    x: -6,
    z: 6,
    collider: 0.5,
    targetable: true,
    name: 'かかし',
    hp: 100,
    hpMax: 100,
    scarecrow: { hp: 100, respawnMs: 5000 },
    children: [
      { id: 'scarecrow-visual', kind: 'sprite', image: 'square/scarecrow.png', w: 1.2, h: 1.6 },
      {
        id: 'scarecrow-hp',
        kind: 'bar',
        y: 2.0,
        w: 1.2,
        h: 0.16,
        source: 'parent',
        valueFrom: 'hp',
        maxFrom: 'hpMax',
      },
    ],
  })

  // 帰りのポータル(→はじまりの広場)。portal属性はクライアントが解釈する
  scene.push(
    {
      id: 'portal-square',
      kind: 'sprite',
      image: 'portal.png',
      x: 0,
      z: -7,
      w: 1.6,
      h: 2.2,
      interactable: true,
      portal: 'square',
    },
    { id: 'portal-square-label', kind: 'text', x: 0, z: -7, y: 2.6, text: '→ はじまりの広場' },
  )

  const world = {
    version: 1,
    id: 'island',
    name: '南の小島',
    size: MAP_SIZE,
    spawn: SPAWN,
    scene,
    scripts: ['../gimmicks/scarecrow.wasm'],
  }
  return `${JSON.stringify(world, null, 2)}\n`
}

// ---------------------------------------------------------------------------
// エントリポイント
// ---------------------------------------------------------------------------

interface GenerateResult {
  json: string
  groundPng: string // dataURL(webp)
  portalPng: string // dataURL
}

async function generate(): Promise<GenerateResult> {
  const [grass, sand] = await Promise.all([
    loadImage('/textures/grass.jpg'),
    loadImage('/textures/sand.jpg'),
  ])
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = TEX_SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2d context unavailable')
  paintGround(ctx, { grass, sand })
  document.body.appendChild(canvas) // 目視確認用
  return {
    json: buildWorldJson(),
    groundPng: canvas.toDataURL('image/webp', 0.9),
    portalPng: paintPortal().toDataURL('image/png'),
  }
}

declare global {
  interface Window {
    __generate: () => Promise<GenerateResult>
  }
}

window.__generate = generate
