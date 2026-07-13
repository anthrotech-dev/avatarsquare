import * as THREE from 'three'
import { HEDGES, MAP_SIZE, POND, ROCKS, TREES } from './MapDef'

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

/** 草地・小道・池を1枚に描き込んだ2Dマップ画像を生成する */
function paintGroundTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = TEX_SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2d context unavailable')

  // 草地ベース
  ctx.fillStyle = '#79a860'
  ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE)

  // 草のまだら模様
  for (let i = 0; i < 6000; i++) {
    const x = Math.random() * TEX_SIZE
    const y = Math.random() * TEX_SIZE
    const r = 2 + Math.random() * 10
    ctx.fillStyle = Math.random() < 0.5 ? 'rgba(90, 140, 70, 0.25)' : 'rgba(140, 185, 105, 0.2)'
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }

  // 小道(マップを斜めに横切る)
  const drawPath = (width: number, color: string) => {
    ctx.strokeStyle = color
    ctx.lineWidth = unitToPx(width)
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(worldToPx(-28), worldToPx(16))
    ctx.quadraticCurveTo(worldToPx(-8), worldToPx(8), worldToPx(0), worldToPx(0))
    ctx.quadraticCurveTo(worldToPx(10), worldToPx(-10), worldToPx(28), worldToPx(-14))
    ctx.stroke()
  }
  drawPath(3.6, '#a8916b')
  drawPath(2.8, '#c2ab80')

  // 池(砂の縁 + 水面)
  const pond = (rx: number, rz: number, color: string) => {
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.ellipse(worldToPx(POND.x), worldToPx(POND.z), unitToPx(rx), unitToPx(rz), 0, 0, Math.PI * 2)
    ctx.fill()
  }
  pond(POND.rx + 0.8, POND.rz + 0.8, '#cdbd8d')
  pond(POND.rx, POND.rz, '#5d9bc7')
  pond(POND.rx - 1.2, POND.rz - 1.0, '#74b3da')

  // マップ外周を暗くする
  const edge = ctx.createRadialGradient(
    TEX_SIZE / 2,
    TEX_SIZE / 2,
    TEX_SIZE * 0.4,
    TEX_SIZE / 2,
    TEX_SIZE / 2,
    TEX_SIZE * 0.72,
  )
  edge.addColorStop(0, 'rgba(30, 50, 30, 0)')
  edge.addColorStop(1, 'rgba(30, 50, 30, 0.45)')
  ctx.fillStyle = edge
  ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE)

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
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

function treeTexture(): THREE.CanvasTexture {
  return paintSprite(192, 256, (ctx, w, h) => {
    // 幹
    ctx.fillStyle = '#7a5636'
    ctx.fillRect(w * 0.45, h * 0.6, w * 0.1, h * 0.4)
    // 葉(重ねた円で2Dイラスト風に)
    const blobs: Array<[number, number, number, string]> = [
      [0.5, 0.42, 0.3, '#3d7a44'],
      [0.32, 0.5, 0.22, '#356b3c'],
      [0.68, 0.5, 0.22, '#356b3c'],
      [0.5, 0.28, 0.24, '#4c9153'],
      [0.4, 0.36, 0.16, '#5aa763'],
    ]
    for (const [x, y, r, color] of blobs) {
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.arc(w * x, h * y, w * r, 0, Math.PI * 2)
      ctx.fill()
    }
  })
}

function rockTexture(): THREE.CanvasTexture {
  return paintSprite(160, 112, (ctx, w, h) => {
    ctx.fillStyle = '#8d939e'
    ctx.beginPath()
    ctx.moveTo(w * 0.1, h * 0.9)
    ctx.lineTo(w * 0.05, h * 0.55)
    ctx.lineTo(w * 0.3, h * 0.2)
    ctx.lineTo(w * 0.7, h * 0.12)
    ctx.lineTo(w * 0.95, h * 0.5)
    ctx.lineTo(w * 0.9, h * 0.9)
    ctx.closePath()
    ctx.fill()
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
    const blobs: Array<[number, number, number, string]> = [
      [0.3, 0.65, 0.28, '#3f7d3f'],
      [0.7, 0.65, 0.28, '#3f7d3f'],
      [0.5, 0.45, 0.32, '#4c944c'],
      [0.5, 0.6, 0.2, '#5aa75a'],
    ]
    for (const [x, y, r, color] of blobs) {
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.arc(w * x, h * y, w * r, 0, Math.PI * 2)
      ctx.fill()
    }
  })
}

/** 足元の楕円影(2Dルック用のフェイクシャドウ) */
function makeBlobShadow(radius: number): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 24),
    new THREE.MeshBasicMaterial({ color: 0x1e321e, transparent: true, opacity: 0.3 }),
  )
  mesh.rotation.x = -Math.PI / 2
  mesh.scale.y = 0.6 // 奥行きを潰して楕円に
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
  const shadow = makeBlobShadow(width * 0.32)
  group.add(shadow)
  group.position.set(x, 0, z)
  return group
}

export function buildMap(): MapBuild {
  const group = new THREE.Group()

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE),
    new THREE.MeshBasicMaterial({ map: paintGroundTexture() }),
  )
  ground.rotation.x = -Math.PI / 2
  ground.name = 'ground'
  group.add(ground)

  // マップ外の下地
  const void_ = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400),
    new THREE.MeshBasicMaterial({ color: 0x25381f }),
  )
  void_.rotation.x = -Math.PI / 2
  void_.position.y = -0.05
  group.add(void_)

  const treeTex = treeTexture()
  for (const t of TREES) {
    group.add(makeBillboard(treeTex, 2.8 * t.scale, 3.8 * t.scale, t.x, t.z))
  }

  const rockTex = rockTexture()
  for (const r of ROCKS) {
    group.add(makeBillboard(rockTex, 1.6 * r.scale, 1.1 * r.scale, r.x, r.z))
  }

  // 生け垣はブッシュを並べて表現する
  const bushTex = bushTexture()
  for (const hedge of HEDGES) {
    const horizontal = hedge.w >= hedge.d
    const length = horizontal ? hedge.w : hedge.d
    const count = Math.max(2, Math.round(length / 1.4))
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0.5 : i / (count - 1)
      const offset = (t - 0.5) * (length - 1)
      const x = hedge.x + (horizontal ? offset : 0)
      const z = hedge.z + (horizontal ? 0 : offset)
      group.add(makeBillboard(bushTex, 1.9, 1.5, x, z))
    }
  }

  return { group, ground }
}
