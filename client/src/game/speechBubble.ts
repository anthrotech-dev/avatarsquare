import * as THREE from 'three'

/**
 * 頭上のチャット吹き出し。Nameplateと同じくcanvas1枚を使い回し、
 * テキスト変更は再描画+needsUpdateのみで済ませる(dispose対象を増やさない)。
 * 表示時間はupdate(delta)のカウントダウンで管理する(setTimeoutだと
 * dispose後の発火やタブ非アクティブ時のずれがあるため、ゲームループ駆動に統一)。
 * 連投時は最新の発言で上書きする。
 */

const CANVAS_W = 512
const CANVAS_H = 256
const FONT = '36px "Hiragino Sans", "Noto Sans JP", sans-serif'
const PAD_X = 24
const PAD_Y = 16
const LINE_H = 46
const RADIUS = 20
/** スプライトのワールド寸法(canvasと同じ2:1) */
export const BUBBLE_WORLD_W = 2.2
export const BUBBLE_WORLD_H = 1.1

export const MAX_BUBBLE_LINES = 4

/** 表示時間(秒)。長文ほど長く、3〜10秒にクランプ */
export function chatBubbleDuration(text: string): number {
  return THREE.MathUtils.clamp(2 + [...text].length * 0.06, 3, 10)
}

/**
 * コードポイント単位の貪欲折返し(日本語は空白区切りがないため単語単位にしない)。
 * maxLinesを超える分は最終行の末尾を省略記号に置き換える。
 * measureを注入するのはテスト(jsdomにcanvas 2Dコンテキストがない)のため。
 */
export function wrapChatLines(
  text: string,
  maxWidth: number,
  measure: (s: string) => number,
  maxLines: number = MAX_BUBBLE_LINES,
): string[] {
  const lines: string[] = []
  let line = ''
  for (const char of text) {
    if (line !== '' && measure(line + char) > maxWidth) {
      lines.push(line)
      line = ''
      if (lines.length === maxLines) {
        let last = lines[maxLines - 1]
        while (last !== '' && measure(`${last}…`) > maxWidth) {
          last = [...last].slice(0, -1).join('')
        }
        lines[maxLines - 1] = `${last}…`
        return lines
      }
    }
    line += char
  }
  if (line !== '') lines.push(line)
  return lines
}

export class SpeechBubble {
  readonly sprite: THREE.Sprite
  private readonly canvas: HTMLCanvasElement
  private readonly texture: THREE.CanvasTexture
  private readonly material: THREE.SpriteMaterial
  /** 残り表示時間(秒)。0以下で非表示 */
  private remaining = 0

  constructor() {
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
    this.sprite.scale.set(BUBBLE_WORLD_W, BUBBLE_WORLD_H, 1)
    this.sprite.visible = false
  }

  /** 吹き出しを表示する。表示中なら本文とタイマーを上書き */
  show(text: string): void {
    const ctx = this.canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H)
    ctx.font = FONT

    const maxTextWidth = CANVAS_W - PAD_X * 2
    const lines = wrapChatLines(text, maxTextWidth, (s) => ctx.measureText(s).width)
    if (lines.length === 0) return

    // 下寄せ(アバターに近い側)で行数分だけ背景を描く=長文ほど上に伸びる
    const boxWidth =
      Math.min(maxTextWidth, Math.max(...lines.map((l) => ctx.measureText(l).width))) + PAD_X * 2
    const boxHeight = lines.length * LINE_H + PAD_Y * 2
    const boxTop = CANVAS_H - boxHeight
    ctx.fillStyle = 'rgba(20, 24, 32, 0.75)'
    ctx.beginPath()
    ctx.roundRect((CANVAS_W - boxWidth) / 2, boxTop, boxWidth, boxHeight, RADIUS)
    ctx.fill()

    ctx.fillStyle = '#f2f5fa'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    lines.forEach((line, i) => {
      ctx.fillText(line, CANVAS_W / 2, boxTop + PAD_Y + LINE_H * (i + 0.5), maxTextWidth)
    })

    this.texture.needsUpdate = true
    this.sprite.visible = true
    this.remaining = chatBubbleDuration(text)
  }

  update(delta: number): void {
    if (!this.sprite.visible) return
    this.remaining -= delta
    if (this.remaining <= 0) this.sprite.visible = false
  }

  dispose(): void {
    this.texture.dispose()
    this.material.dispose()
  }
}
