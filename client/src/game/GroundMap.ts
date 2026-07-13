import * as THREE from 'three'
import {
  BEACH_WIDTH,
  BUSHES,
  coastX,
  FOREST_Z,
  FOUNTAIN,
  MAP_SIZE,
  PLAZA,
  ROCKS,
  TREES,
  type TreeKind,
} from './MapDef'

export interface MapBuild {
  group: THREE.Group
  ground: THREE.Mesh
}

const TEX_SIZE = 2048

function worldToPx(v: number): number {
  return ((v + MAP_SIZE / 2) / MAP_SIZE) * TEX_SIZE
}

function unitToPx(v: number): number {
  return (v / MAP_SIZE) * TEX_SIZE
}

interface GroundImages {
  grass: HTMLImageElement | null
  paving: HTMLImageElement | null
  sand: HTMLImageElement | null
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`failed to load ${url}`))
    img.src = url
  })
}

/** タイル素材をワールド寸法に合わせて敷き詰めるパターン。素材未読込時は単色 */
function makePattern(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement | null,
  worldTile: number,
  fallback: string,
): string | CanvasPattern {
  if (!img) return fallback
  const pattern = ctx.createPattern(img, 'repeat')
  if (!pattern) return fallback
  const scale = unitToPx(worldTile) / img.width
  pattern.setTransform(new DOMMatrix().scale(scale))
  return pattern
}

/** 海岸線に平行なポリラインをつくる(offset>0で海側) */
function coastPath(ctx: CanvasRenderingContext2D, offset: number): void {
  ctx.beginPath()
  for (let z = -MAP_SIZE / 2; z <= MAP_SIZE / 2; z += 1) {
    const px = worldToPx(coastX(z) + offset)
    const py = worldToPx(z)
    if (z === -MAP_SIZE / 2) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
}

/** 広場(レンガ)・草原・森・砂浜・海を1枚に描き込む */
function paintGround(ctx: CanvasRenderingContext2D, images: GroundImages): void {
  const grassPattern = makePattern(ctx, images.grass, 7, '#7aa860')
  const pavingPattern = makePattern(ctx, images.paving, 4, '#b0a293')
  const sandPattern = makePattern(ctx, images.sand, 6, '#d9c391')

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

function paintSprite(
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2d context unavailable')
  draw(ctx, width, height)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

function blob(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  fill: string,
  outline?: string,
): void {
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fillStyle = fill
  ctx.fill()
  if (outline) {
    ctx.strokeStyle = outline
    ctx.lineWidth = 5
    ctx.stroke()
  }
}

function roundTreeTexture(): THREE.CanvasTexture {
  return paintSprite(192, 256, (ctx, w, h) => {
    ctx.fillStyle = '#6d4a2e'
    ctx.fillRect(w * 0.45, h * 0.55, w * 0.1, h * 0.45)
    blob(ctx, w * 0.32, h * 0.46, w * 0.22, '#2f6136', '#254d2b')
    blob(ctx, w * 0.68, h * 0.46, w * 0.22, '#2f6136', '#254d2b')
    blob(ctx, w * 0.5, h * 0.36, w * 0.28, '#3c7a44', '#2c5a33')
    blob(ctx, w * 0.42, h * 0.28, w * 0.14, '#4f9556')
    blob(ctx, w * 0.58, h * 0.42, w * 0.1, '#356b3c')
  })
}

function pineTreeTexture(): THREE.CanvasTexture {
  return paintSprite(192, 256, (ctx, w, h) => {
    ctx.fillStyle = '#5d3f27'
    ctx.fillRect(w * 0.46, h * 0.72, w * 0.08, h * 0.28)
    const layer = (cy: number, half: number, color: string) => {
      ctx.beginPath()
      ctx.moveTo(w * 0.5, h * (cy - 0.24))
      ctx.lineTo(w * (0.5 - half), h * cy)
      ctx.lineTo(w * (0.5 + half), h * cy)
      ctx.closePath()
      ctx.fillStyle = color
      ctx.fill()
      ctx.strokeStyle = '#1d3d2b'
      ctx.lineWidth = 4
      ctx.stroke()
    }
    layer(0.78, 0.34, '#28513a')
    layer(0.58, 0.28, '#2e5d41')
    layer(0.4, 0.21, '#38704d')
  })
}

function rockTexture(): THREE.CanvasTexture {
  return paintSprite(160, 112, (ctx, w, h) => {
    ctx.beginPath()
    ctx.moveTo(w * 0.1, h * 0.9)
    ctx.lineTo(w * 0.05, h * 0.55)
    ctx.lineTo(w * 0.3, h * 0.2)
    ctx.lineTo(w * 0.7, h * 0.12)
    ctx.lineTo(w * 0.95, h * 0.5)
    ctx.lineTo(w * 0.9, h * 0.9)
    ctx.closePath()
    ctx.fillStyle = '#8d939e'
    ctx.fill()
    ctx.strokeStyle = '#5f646d'
    ctx.lineWidth = 5
    ctx.stroke()
    ctx.fillStyle = 'rgba(255, 255, 255, 0.25)'
    ctx.beginPath()
    ctx.moveTo(w * 0.3, h * 0.2)
    ctx.lineTo(w * 0.7, h * 0.12)
    ctx.lineTo(w * 0.6, h * 0.4)
    ctx.lineTo(w * 0.35, h * 0.45)
    ctx.closePath()
    ctx.fill()
  })
}

function bushTexture(): THREE.CanvasTexture {
  return paintSprite(160, 128, (ctx, w, h) => {
    blob(ctx, w * 0.3, h * 0.65, w * 0.26, '#3a743a', '#2b572b')
    blob(ctx, w * 0.7, h * 0.65, w * 0.26, '#3a743a', '#2b572b')
    blob(ctx, w * 0.5, h * 0.48, w * 0.3, '#478a47', '#336633')
    blob(ctx, w * 0.42, h * 0.4, w * 0.12, '#57a057')
  })
}

/** 足元の楕円影(2Dルック用のフェイクシャドウ) */
function makeBlobShadow(radius: number): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 24),
    new THREE.MeshBasicMaterial({ color: 0x1e321e, transparent: true, opacity: 0.28 }),
  )
  mesh.rotation.x = -Math.PI / 2
  mesh.scale.y = 0.6
  mesh.position.y = 0.02
  return mesh
}

function makeBillboard(
  texture: THREE.Texture,
  width: number,
  height: number,
  x: number,
  z: number,
): THREE.Group {
  const group = new THREE.Group()
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, alphaTest: 0.5, transparent: true }),
  )
  sprite.center.set(0.5, 0.02)
  sprite.scale.set(width, height, 1)
  group.add(sprite)
  group.add(makeBlobShadow(width * 0.32))
  group.position.set(x, 0, z)
  return group
}

function buildFountain(): THREE.Group {
  const group = new THREE.Group()
  const stone = new THREE.MeshStandardMaterial({ color: 0x9a948a, roughness: 0.9 })
  const water = new THREE.MeshBasicMaterial({ color: 0x66b5da })

  const basin = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.55, 0.6, 28), stone)
  basin.position.y = 0.3
  const pool = new THREE.Mesh(new THREE.CircleGeometry(2.1, 28), water)
  pool.rotation.x = -Math.PI / 2
  pool.position.y = 0.62
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.5, 1.1, 16), stone)
  pillar.position.y = 1.1
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.6, 0.28, 20), stone)
  bowl.position.y = 1.72
  const bowlWater = new THREE.Mesh(new THREE.CircleGeometry(0.72, 20), water)
  bowlWater.rotation.x = -Math.PI / 2
  bowlWater.position.y = 1.87

  group.add(basin, pool, pillar, bowl, bowlWater)
  group.position.set(FOUNTAIN.x, 0, FOUNTAIN.z)
  return group
}

export function buildMap(): MapBuild {
  const group = new THREE.Group()

  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = TEX_SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2d context unavailable')

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4

  // まず単色で描いておき、素材が読み込めたら敷き直す
  paintGround(ctx, { grass: null, paving: null, sand: null })
  void Promise.all([
    loadImage('/textures/grass.jpg'),
    loadImage('/textures/paving.jpg'),
    loadImage('/textures/sand.jpg'),
  ])
    .then(([grass, paving, sand]) => {
      paintGround(ctx, { grass, paving, sand })
      tex.needsUpdate = true
    })
    .catch(() => {
      // 素材が無くても単色で動く
    })

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE),
    new THREE.MeshBasicMaterial({ map: tex }),
  )
  ground.rotation.x = -Math.PI / 2
  ground.name = 'ground'
  group.add(ground)

  // マップ外の下地
  const void_ = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400),
    new THREE.MeshBasicMaterial({ color: 0x1c2f22 }),
  )
  void_.rotation.x = -Math.PI / 2
  void_.position.y = -0.05
  group.add(void_)

  group.add(buildFountain())

  const textures: Record<TreeKind, THREE.CanvasTexture> = {
    round: roundTreeTexture(),
    pine: pineTreeTexture(),
  }
  for (const t of TREES) {
    const size: Record<TreeKind, [number, number]> = {
      round: [2.8 * t.scale, 3.8 * t.scale],
      pine: [2.2 * t.scale, 3.6 * t.scale],
    }
    const [w, h] = size[t.kind]
    group.add(makeBillboard(textures[t.kind], w, h, t.x, t.z))
  }

  const rockTex = rockTexture()
  for (const r of ROCKS) {
    group.add(makeBillboard(rockTex, 1.6 * r.scale, 1.1 * r.scale, r.x, r.z))
  }

  const bushTex = bushTexture()
  for (const b of BUSHES) {
    group.add(makeBillboard(bushTex, 1.9 * b.scale, 1.5 * b.scale, b.x, b.z))
  }

  return { group, ground }
}
