import * as THREE from 'three'

/**
 * 頭上ネームプレート。固定サイズのcanvasを1枚使い回し、
 * テキスト変更は再描画+needsUpdateのみで済ませる(dispose対象を増やさない)。
 * Spriteは常にカメラ正対。平行投影でもsizeAttenuationデフォルトのまま
 * ワールド単位スケールで表示される。
 */

const CANVAS_W = 512
const CANVAS_H = 128
const FONT = '56px "Hiragino Sans", "Noto Sans JP", sans-serif'
const PAD_X = 28
const RADIUS = 24
/** スプライトのワールド寸法 */
const WORLD_W = 1.4
const WORLD_H = 0.35

export class Nameplate {
  readonly sprite: THREE.Sprite
  private readonly canvas: HTMLCanvasElement
  private readonly texture: THREE.CanvasTexture
  private readonly material: THREE.SpriteMaterial

  constructor(text: string) {
    this.canvas = document.createElement('canvas')
    this.canvas.width = CANVAS_W
    this.canvas.height = CANVAS_H
    this.texture = new THREE.CanvasTexture(this.canvas)
    this.texture.colorSpace = THREE.SRGBColorSpace
    this.material = new THREE.SpriteMaterial({
      map: this.texture,
      transparent: true,
      depthWrite: false,
    })
    this.sprite = new THREE.Sprite(this.material)
    this.sprite.scale.set(WORLD_W, WORLD_H, 1)
    this.setText(text)
  }

  setText(text: string): void {
    if (!text) {
      this.sprite.visible = false
      return
    }
    this.sprite.visible = true

    const ctx = this.canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H)
    ctx.font = FONT
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    const textWidth = Math.min(ctx.measureText(text).width, CANVAS_W - PAD_X * 2)
    const boxWidth = textWidth + PAD_X * 2
    ctx.fillStyle = 'rgba(20, 24, 32, 0.6)'
    ctx.beginPath()
    ctx.roundRect((CANVAS_W - boxWidth) / 2, 8, boxWidth, CANVAS_H - 16, RADIUS)
    ctx.fill()

    ctx.fillStyle = '#f2f5fa'
    ctx.fillText(text, CANVAS_W / 2, CANVAS_H / 2 + 2, CANVAS_W - PAD_X * 2)
    this.texture.needsUpdate = true
  }

  dispose(): void {
    this.texture.dispose()
    this.material.dispose()
  }
}
