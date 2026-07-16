/**
 * squareワールドの生成器(開発用・一度きりの移行スクリプト兼、再生成手段)。
 *
 * かつて client/src/game/MapDef.ts / GroundMap.ts にハードコードされていた
 * マップ定義と地面のプロシージャル描画をここへ移し、実行結果を
 * public/worlds/square.json と public/worlds/square/ground.png として書き出す。
 * 以後はこの生成物がワールドの正本になる(ランタイムは生成コードを持たない)。
 *
 * 実行方法: vite devでこのページを開き、Playwright等から window.__generate() を呼ぶ。
 * テクスチャ素材(/textures, /sprites)を実際に読み込んで焼き込むためブラウザで動かす。
 */

const MAP_SIZE = 60
const TEX_SIZE = 2048

const SPAWN = { x: 3, z: 5 }
const PLAZA = { x: 0, z: 0, r: 11 }
const FOUNTAIN = { x: 0, z: 0, r: 2.4 }
const FOREST_Z = -13
const BEACH_WIDTH = 4.5

/** 海岸線。このxより東は海(通行不可)。砂浜はこの手前4.5ユニット */
function coastX(z: number): number {
  return 17 + 2.5 * Math.sin(z * 0.11)
}

type TreeKind = 'oak' | 'broad' | 'pine' | 'palm' | 'autumn'
type RockKind = 'brown' | 'gray'
interface PropDef {
  x: number
  z: number
  scale: number
}

const TREES: Array<PropDef & { kind: TreeKind }> = [
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

const ROCKS: Array<PropDef & { kind: RockKind }> = [
  { x: 12, z: -14, scale: 0.9, kind: 'gray' }, // 砂浜の岩
  { x: -20, z: -8, scale: 1.2, kind: 'brown' },
  { x: 12, z: 16, scale: 0.8, kind: 'brown' },
  { x: -15, z: 3, scale: 1.0, kind: 'gray' },
]

/** 広場の縁を飾るブッシュ(東と南西の出入り口は空けてある) */
const BUSHES: PropDef[] = [
  { x: 9.2, z: 7.7, scale: 1.0 },
  { x: 0, z: 12, scale: 1.1 },
  { x: -12, z: 0, scale: 1.0 },
  { x: -9.2, z: -7.7, scale: 1.0 },
  { x: -4.1, z: -11.3, scale: 1.1 },
  { x: 4.1, z: -11.3, scale: 1.0 },
  { x: 9.2, z: -7.7, scale: 1.1 },
]

/** 各素材の寸法(幅, 高さ)は画像のアスペクト比に合わせてある(旧GroundMap.tsと同値) */
const TREE_DEFS: Record<TreeKind, { url: string; w: number; h: number }> = {
  oak: { url: '/sprites/tree-oak.png', w: 3.2, h: 3.4 },
  broad: { url: '/sprites/tree-broad.png', w: 4.1, h: 3.2 },
  autumn: { url: '/sprites/tree-autumn.png', w: 2.35, h: 3.4 },
  pine: { url: '/sprites/tree-pine.png', w: 1.9, h: 3.8 },
  palm: { url: '/sprites/tree-palm.png', w: 2.2, h: 3.7 },
}
const ROCK_DEFS: Record<RockKind, { url: string; w: number; h: number }> = {
  brown: { url: '/sprites/rock-brown.png', w: 1.6, h: 0.83 },
  gray: { url: '/sprites/rock-gray.png', w: 1.35, h: 0.85 },
}
const BUSH_DEF = { url: '/sprites/tree-bush.png', w: 1.15, h: 1.9 }

// 通行判定用の足元半径の係数(旧MapDef.getObstacles()と同値)
const TREE_COLLIDER = 0.55
const ROCK_COLLIDER = 0.7
const BUSH_COLLIDER = 0.6

// ---------------------------------------------------------------------------
// 地面テクスチャの描画(旧GroundMap.paintGround + 噴水の真上ビュー焼き込み)
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

/** タイル素材をワールド寸法に合わせて敷き詰めるパターン */
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

/** 海岸線に平行なポリライン(offset>0で海側) */
function coastPath(ctx: CanvasRenderingContext2D, offset: number): void {
  ctx.beginPath()
  for (let z = -MAP_SIZE / 2; z <= MAP_SIZE / 2; z += 1) {
    const px = worldToPx(coastX(z) + offset)
    const py = worldToPx(z)
    if (z === -MAP_SIZE / 2) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
}

interface GroundImages {
  grass: HTMLImageElement
  paving: HTMLImageElement
  sand: HTMLImageElement
}

/** 広場(レンガ)・草原・森・砂浜・海を1枚に描き込む */
function paintGround(ctx: CanvasRenderingContext2D, images: GroundImages): void {
  const grassPattern = makePattern(ctx, images.grass, 7)
  const pavingPattern = makePattern(ctx, images.paving, 4)
  const sandPattern = makePattern(ctx, images.sand, 6)

  // 草原ベース
  ctx.fillStyle = grassPattern
  ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE)

  // 草のまだら(素材の継ぎ目をごまかす)
  for (let i = 0; i < 2500; i++) {
    const x = Math.random() * TEX_SIZE
    const y = Math.random() * TEX_SIZE
    const r = 3 + Math.random() * 14
    ctx.fillStyle = Math.random() < 0.5 ? 'rgba(70, 115, 55, 0.10)' : 'rgba(150, 190, 110, 0.08)'
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }

  // 森(北側)をひとまわり暗くする
  const forestEdge = ctx.createLinearGradient(
    0,
    worldToPx(FOREST_Z + 3),
    0,
    worldToPx(FOREST_Z - 2),
  )
  forestEdge.addColorStop(0, 'rgba(18, 52, 26, 0)')
  forestEdge.addColorStop(1, 'rgba(18, 52, 26, 0.30)')
  ctx.fillStyle = forestEdge
  ctx.fillRect(0, 0, TEX_SIZE, worldToPx(FOREST_Z + 3))

  // 南西へ延びる土の小道(草原を横切る)
  ctx.save()
  ctx.strokeStyle = sandPattern
  ctx.lineWidth = unitToPx(2.6)
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(worldToPx(-8.5), worldToPx(8.5))
  ctx.quadraticCurveTo(worldToPx(-16), worldToPx(13), worldToPx(-26), worldToPx(26))
  ctx.stroke()
  ctx.globalAlpha = 0.25
  ctx.strokeStyle = '#8a7a5c'
  ctx.lineWidth = unitToPx(2.9)
  ctx.stroke()
  ctx.restore()

  // 東の砂浜へ向かう道(広場から)
  ctx.save()
  ctx.strokeStyle = pavingPattern
  ctx.lineWidth = unitToPx(3)
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(worldToPx(9), worldToPx(0))
  ctx.lineTo(worldToPx(16), worldToPx(0))
  ctx.stroke()
  ctx.globalAlpha = 0.3
  ctx.strokeStyle = '#6f6152'
  ctx.lineWidth = unitToPx(3.4)
  ctx.stroke()
  ctx.restore()

  // 砂浜(海岸線の内側から東端まで。海はこの上に重ねる)
  ctx.save()
  coastPath(ctx, -BEACH_WIDTH)
  ctx.lineTo(TEX_SIZE, TEX_SIZE)
  ctx.lineTo(TEX_SIZE, 0)
  ctx.closePath()
  ctx.fillStyle = sandPattern
  ctx.fill()
  ctx.restore()

  // 広場(レンガ敷き + 縁取り)
  const plazaX = worldToPx(PLAZA.x)
  const plazaY = worldToPx(PLAZA.z)
  const plazaR = unitToPx(PLAZA.r)
  ctx.save()
  ctx.beginPath()
  ctx.arc(plazaX, plazaY, plazaR, 0, Math.PI * 2)
  ctx.fillStyle = pavingPattern
  ctx.fill()
  ctx.strokeStyle = 'rgba(90, 76, 60, 0.85)'
  ctx.lineWidth = unitToPx(0.5)
  ctx.stroke()
  // 噴水の土台
  ctx.beginPath()
  ctx.arc(worldToPx(FOUNTAIN.x), worldToPx(FOUNTAIN.z), unitToPx(FOUNTAIN.r + 0.5), 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(120, 110, 96, 0.9)'
  ctx.fill()
  ctx.restore()

  // 海(浅瀬→沖のグラデーション)
  ctx.save()
  coastPath(ctx, 0)
  ctx.lineTo(TEX_SIZE, TEX_SIZE)
  ctx.lineTo(TEX_SIZE, 0)
  ctx.closePath()
  const seaGrad = ctx.createLinearGradient(worldToPx(15), 0, worldToPx(30), 0)
  seaGrad.addColorStop(0, '#7fc5de')
  seaGrad.addColorStop(0.4, '#4f9cc4')
  seaGrad.addColorStop(1, '#2c6c96')
  ctx.fillStyle = seaGrad
  ctx.fill()
  ctx.restore()

  // 濡れた砂 + 波打ち際の泡
  ctx.save()
  ctx.strokeStyle = 'rgba(166, 138, 105, 0.5)'
  ctx.lineWidth = unitToPx(0.8)
  coastPath(ctx, -0.5)
  ctx.stroke()
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)'
  ctx.lineWidth = unitToPx(0.35)
  coastPath(ctx, 0)
  ctx.stroke()
  ctx.setLineDash([unitToPx(3), unitToPx(1.8)])
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)'
  coastPath(ctx, 1.4)
  ctx.stroke()
  ctx.setLineDash([unitToPx(2), unitToPx(2.6)])
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)'
  coastPath(ctx, 2.8)
  ctx.stroke()
  ctx.restore()

  // 噴水(真上から見た姿を焼き込む。旧実装の3Dメッシュはワールドのプリミティブ化で廃止)
  paintFountainTopDown(ctx)

  // マップ外周を暗くする
  const edge = ctx.createRadialGradient(
    TEX_SIZE / 2,
    TEX_SIZE / 2,
    TEX_SIZE * 0.42,
    TEX_SIZE / 2,
    TEX_SIZE / 2,
    TEX_SIZE * 0.74,
  )
  edge.addColorStop(0, 'rgba(24, 40, 28, 0)')
  edge.addColorStop(1, 'rgba(24, 40, 28, 0.38)')
  ctx.fillStyle = edge
  ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE)
}

/** 噴水の真上ビュー。旧buildFountain()の寸法・色(石#9a948a / 水#66b5da)を踏襲 */
function paintFountainTopDown(ctx: CanvasRenderingContext2D): void {
  const cx = worldToPx(FOUNTAIN.x)
  const cy = worldToPx(FOUNTAIN.z)
  const circle = (r: number, fill: string) => {
    ctx.beginPath()
    ctx.arc(cx, cy, unitToPx(r), 0, Math.PI * 2)
    ctx.fillStyle = fill
    ctx.fill()
  }
  ctx.save()
  circle(2.55, '#8f897f') // 外周の縁(わずかに暗い石)
  circle(2.4, '#9a948a') // 石の縁
  circle(2.1, '#66b5da') // 水盤
  // 水面のきらめき
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)'
  ctx.lineWidth = unitToPx(0.08)
  for (const r of [1.2, 1.6, 1.95]) {
    ctx.beginPath()
    ctx.arc(cx, cy, unitToPx(r), Math.PI * 0.15, Math.PI * 0.85)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(cx, cy, unitToPx(r), Math.PI * 1.1, Math.PI * 1.7)
    ctx.stroke()
  }
  circle(0.85, '#9a948a') // 中央の受け皿
  circle(0.72, '#7fc5de') // 受け皿の水
  circle(0.2, '#b9d9e8') // 噴き上げの白
  ctx.restore()
}

// ---------------------------------------------------------------------------
// かかしスプライト(ギミックサンプル用の素材)
// ---------------------------------------------------------------------------

function paintScarecrow(): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = 192
  canvas.height = 256
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2d context unavailable')
  const w = canvas.width
  const h = canvas.height

  // 支柱と横木
  ctx.fillStyle = '#7a5a34'
  ctx.fillRect(w * 0.47, h * 0.18, w * 0.06, h * 0.82)
  ctx.fillRect(w * 0.14, h * 0.34, w * 0.72, h * 0.05)
  // 服(そで付きの上衣)
  ctx.fillStyle = '#b0563a'
  ctx.beginPath()
  ctx.moveTo(w * 0.5, h * 0.3)
  ctx.lineTo(w * 0.2, h * 0.42)
  ctx.lineTo(w * 0.26, h * 0.5)
  ctx.lineTo(w * 0.42, h * 0.46)
  ctx.lineTo(w * 0.38, h * 0.78)
  ctx.lineTo(w * 0.62, h * 0.78)
  ctx.lineTo(w * 0.58, h * 0.46)
  ctx.lineTo(w * 0.74, h * 0.5)
  ctx.lineTo(w * 0.8, h * 0.42)
  ctx.closePath()
  ctx.fill()
  ctx.strokeStyle = '#7d3a26'
  ctx.lineWidth = 4
  ctx.stroke()
  // 裾のわら
  ctx.strokeStyle = '#d9b356'
  ctx.lineWidth = 5
  for (let i = 0; i < 7; i++) {
    const x = w * (0.4 + i * 0.033)
    ctx.beginPath()
    ctx.moveTo(x, h * 0.77)
    ctx.lineTo(x + (i % 2 === 0 ? 4 : -4), h * 0.9)
    ctx.stroke()
  }
  // 頭(麻袋)と笠
  ctx.fillStyle = '#e2c896'
  ctx.beginPath()
  ctx.arc(w * 0.5, h * 0.2, w * 0.13, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = '#b09660'
  ctx.lineWidth = 4
  ctx.stroke()
  // 目と口
  ctx.fillStyle = '#4a3a22'
  ctx.beginPath()
  ctx.arc(w * 0.45, h * 0.19, 4, 0, Math.PI * 2)
  ctx.arc(w * 0.55, h * 0.19, 4, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = '#4a3a22'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.arc(w * 0.5, h * 0.23, 8, Math.PI * 0.15, Math.PI * 0.85)
  ctx.stroke()
  // 笠(三角)
  ctx.fillStyle = '#c9a24e'
  ctx.beginPath()
  ctx.moveTo(w * 0.5, h * 0.02)
  ctx.lineTo(w * 0.3, h * 0.14)
  ctx.lineTo(w * 0.7, h * 0.14)
  ctx.closePath()
  ctx.fill()
  ctx.strokeStyle = '#96762f'
  ctx.lineWidth = 4
  ctx.stroke()
  return canvas
}

function paintSlime(): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = 160
  canvas.height = 128
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2d context unavailable')
  const w = canvas.width
  const h = canvas.height

  // ドーム型のボディ(下すぼまりの半透明ゼリー)
  ctx.fillStyle = '#4fae62'
  ctx.beginPath()
  ctx.moveTo(w * 0.1, h * 0.88)
  ctx.bezierCurveTo(w * 0.06, h * 0.42, w * 0.28, h * 0.1, w * 0.5, h * 0.1)
  ctx.bezierCurveTo(w * 0.72, h * 0.1, w * 0.94, h * 0.42, w * 0.9, h * 0.88)
  ctx.closePath()
  ctx.fill()
  ctx.strokeStyle = '#2f7a42'
  ctx.lineWidth = 5
  ctx.stroke()
  // 底の影(接地感)
  ctx.fillStyle = '#2f7a42'
  ctx.beginPath()
  ctx.ellipse(w * 0.5, h * 0.88, w * 0.4, h * 0.07, 0, 0, Math.PI * 2)
  ctx.fill()
  // ハイライト(ぷるぷる感)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.55)'
  ctx.beginPath()
  ctx.ellipse(w * 0.34, h * 0.32, w * 0.1, h * 0.14, -0.5, 0, Math.PI * 2)
  ctx.fill()
  // 目
  ctx.fillStyle = '#1e3a26'
  ctx.beginPath()
  ctx.ellipse(w * 0.4, h * 0.52, 6, 9, 0, 0, Math.PI * 2)
  ctx.ellipse(w * 0.6, h * 0.52, 6, 9, 0, 0, Math.PI * 2)
  ctx.fill()
  // 口(にっこり)
  ctx.strokeStyle = '#1e3a26'
  ctx.lineWidth = 4
  ctx.beginPath()
  ctx.arc(w * 0.5, h * 0.58, 12, Math.PI * 0.2, Math.PI * 0.8)
  ctx.stroke()
  return canvas
}

// ---------------------------------------------------------------------------
// ワールドJSONの生成
// ---------------------------------------------------------------------------

function round(v: number): number {
  return Math.round(v * 1000) / 1000
}

/** 海の通行不可ポリゴン。旧buildNavGridの `x > coastX(z) - 0.3` を1m刻みで近似 */
function seaPolygon(): [number, number][] {
  const points: [number, number][] = []
  for (let z = -MAP_SIZE / 2; z <= MAP_SIZE / 2; z += 1) {
    points.push([round(coastX(z) - 0.3), z])
  }
  // マップ東端の外側を回って閉じる
  points.push([MAP_SIZE / 2 + 5, MAP_SIZE / 2])
  points.push([MAP_SIZE / 2 + 5, -MAP_SIZE / 2])
  return points
}

function buildWorldJson(): string {
  const scene: Record<string, unknown>[] = [
    { id: 'ground', kind: 'ground', texture: 'square/ground.webp' },
    { id: 'sea', kind: 'collider', shape: 'polygon', points: seaPolygon() },
    { id: 'fountain', kind: 'collider', shape: 'circle', x: FOUNTAIN.x, z: FOUNTAIN.z, r: FOUNTAIN.r },
  ]
  TREES.forEach((t, i) => {
    const def = TREE_DEFS[t.kind]
    scene.push({
      id: `tree-${i + 1}`,
      kind: 'sprite',
      image: def.url,
      x: t.x,
      z: t.z,
      w: round(def.w * t.scale),
      h: round(def.h * t.scale),
      collider: round(TREE_COLLIDER * t.scale),
    })
  })
  ROCKS.forEach((r, i) => {
    const def = ROCK_DEFS[r.kind]
    scene.push({
      id: `rock-${i + 1}`,
      kind: 'sprite',
      image: def.url,
      x: r.x,
      z: r.z,
      w: round(def.w * r.scale),
      h: round(def.h * r.scale),
      collider: round(ROCK_COLLIDER * r.scale),
    })
  })
  BUSHES.forEach((b, i) => {
    scene.push({
      id: `bush-${i + 1}`,
      kind: 'sprite',
      image: BUSH_DEF.url,
      x: b.x,
      z: b.z,
      w: round(BUSH_DEF.w * b.scale),
      h: round(BUSH_DEF.h * b.scale),
      collider: round(BUSH_COLLIDER * b.scale),
    })
  })

  // ギミックのサンプル: かかし(攻撃でHP減少・倒れて復活)とカウンターボタン。
  // ノードは汎用プリミティブ(group/sprite/bar/cylinder/text)で、振る舞いは
  // scripts のwasm(gimmicks/)がノードのscarecrow/counter属性を見て担う。
  // かかしはツリー構造の実例: 親groupがデータ(hp等)を持ち、子がビジュアル。
  // HPゲージは親のhp/hpMax属性を表示するデータバインドbar
  scene.push(
    {
      id: 'scarecrow',
      kind: 'group',
      x: -6,
      z: -3,
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
    },
    {
      id: 'counter-button',
      kind: 'cylinder',
      x: 4,
      z: 9,
      r: 0.4,
      h: 0.3,
      color: '#cc3333',
      collider: 0.5,
      interactable: true,
      counter: { label: 'counter-label' },
    },
    { id: 'counter-label', kind: 'text', x: 4, z: 9, y: 1.5, text: '0' },
  )

  // スライム召喚ボタン: interactでスライム(追跡・近接攻撃エンティティ)が湧く。
  // 振る舞いはgimmicks/slime.wasmがslime属性を見て担う
  scene.push(
    {
      id: 'slime-button',
      kind: 'cylinder',
      x: 7,
      z: 9,
      r: 0.4,
      h: 0.3,
      color: '#44aa44',
      collider: 0.5,
      interactable: true,
      slime: {
        hp: 30,
        speed: 1.2,
        aggroRange: 6,
        attackRange: 1.0,
        attackMs: 2000,
        image: 'square/slime.png',
        spawnOffset: [2, 0],
      },
    },
    { id: 'slime-button-label', kind: 'text', x: 7, z: 9, y: 1.5, text: 'スライム召喚' },
  )

  // 南の小島へのポータル(東の砂浜への道の先)。portal属性はクライアントが解釈して
  // ワールド切替する(画像はワールド間共有の /worlds/portal.png、island生成器が出力)
  scene.push(
    {
      id: 'portal-island',
      kind: 'sprite',
      image: 'portal.png',
      x: 12,
      z: 2,
      w: 1.6,
      h: 2.2,
      interactable: true,
      portal: 'island',
    },
    { id: 'portal-island-label', kind: 'text', x: 12, z: 2, y: 2.6, text: '→ 南の小島' },
  )

  const world = {
    version: 1,
    id: 'square',
    name: 'はじまりの広場',
    size: MAP_SIZE,
    spawn: SPAWN,
    scene,
    scripts: ['../gimmicks/scarecrow.wasm', '../gimmicks/counter.wasm', '../gimmicks/slime.wasm'],
  }
  return `${JSON.stringify(world, null, 2)}\n`
}

// ---------------------------------------------------------------------------
// エントリポイント
// ---------------------------------------------------------------------------

interface GenerateResult {
  json: string
  groundPng: string // dataURL
  scarecrowPng: string // dataURL
  slimePng: string // dataURL
}

async function generate(): Promise<GenerateResult> {
  const [grass, paving, sand] = await Promise.all([
    loadImage('/textures/grass.jpg'),
    loadImage('/textures/paving.jpg'),
    loadImage('/textures/sand.jpg'),
  ])
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = TEX_SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2d context unavailable')
  paintGround(ctx, { grass, paving, sand })
  document.body.appendChild(canvas) // 目視確認用
  return {
    json: buildWorldJson(),
    // 地面は非透過かつ巨大(2048px)なのでWebPで書き出す(PNGだと~9MBになる)
    groundPng: canvas.toDataURL('image/webp', 0.9),
    scarecrowPng: paintScarecrow().toDataURL('image/png'),
    slimePng: paintSlime().toDataURL('image/png'),
  }
}

declare global {
  interface Window {
    __generate: () => Promise<GenerateResult>
  }
}

window.__generate = generate
