import * as THREE from 'three'
import type { PeerVoiceState } from '../net/VoiceChat'

/**
 * 頭上ネームプレート。固定サイズのcanvasを1枚使い回し、
 * テキスト変更は再描画+needsUpdateのみで済ませる(dispose対象を増やさない)。
 * Spriteは常にカメラ正対。平行投影でもsizeAttenuationデフォルトのまま
 * ワールド単位スケールで表示される。
 *
 * ボイスチャット対応: VC参加中は名前の左にマイクアイコン(ミュート中は🔇)、
 * 発話中は枠を発話色で描く。speakingは高頻度で切り替わるため、
 * 状態が変わらない再設定では再描画しない。
 */

const CANVAS_W = 512
const CANVAS_H = 128
const FONT = '56px "Hiragino Sans", "Noto Sans JP", sans-serif'
const PAD_X = 28
const RADIUS = 24
/** スプライトのワールド寸法 */
const WORLD_W = 1.4
const WORLD_H = 0.35
/** 発話中の枠色 */
const SPEAKING_COLOR = '#7cfc8a'

export class Nameplate {
  readonly sprite: THREE.Sprite
  private readonly canvas: HTMLCanvasElement
  private readonly texture: THREE.CanvasTexture
  private readonly material: THREE.SpriteMaterial
  private text = ''
  private voiceState: PeerVoiceState = 'off'
  private speaking = false

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
    if (text === this.text && this.sprite.visible === !!text) return
    this.text = text
    this.redraw()
  }

  /** VC状態(アイコン表示)。offで非表示、mutedは🔇 */
  setVoiceState(state: PeerVoiceState): void {
    if (state === this.voiceState) return
    this.voiceState = state
    this.redraw()
  }

  /** 発話中の枠色表示 */
  setSpeaking(speaking: boolean): void {
    if (speaking === this.speaking) return
    this.speaking = speaking
    this.redraw()
  }

  private redraw(): void {
    // 名前が空ならアイコンも含めて非表示(既存挙動と整合)
    if (!this.text) {
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

    const icon = this.voiceState === 'off' ? '' : this.voiceState === 'muted' ? '🔇 ' : '🎤 '
    const label = icon + this.text
    const textWidth = Math.min(ctx.measureText(label).width, CANVAS_W - PAD_X * 2)
    const boxWidth = textWidth + PAD_X * 2
    ctx.fillStyle = 'rgba(20, 24, 32, 0.6)'
    ctx.beginPath()
    ctx.roundRect((CANVAS_W - boxWidth) / 2, 8, boxWidth, CANVAS_H - 16, RADIUS)
    ctx.fill()
    if (this.speaking) {
      ctx.strokeStyle = SPEAKING_COLOR
      ctx.lineWidth = 6
      ctx.stroke()
    }

    ctx.fillStyle = this.speaking ? SPEAKING_COLOR : '#f2f5fa'
    ctx.fillText(label, CANVAS_W / 2, CANVAS_H / 2 + 2, CANVAS_W - PAD_X * 2)
    this.texture.needsUpdate = true
  }

  dispose(): void {
    this.texture.dispose()
    this.material.dispose()
  }
}
