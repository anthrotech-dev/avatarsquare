import * as THREE from 'three'
import {
  AVATAR_LAYER,
  CAPTURE_CENTER_Y,
  CAPTURE_FPS,
  CAPTURE_PX_H,
  CAPTURE_PX_W,
  CAPTURE_WORLD_H,
  CAPTURE_WORLD_W,
} from './captureSpec'

/**
 * 自アバターだけをオフスクリーンでレンダリングし、映像トラック化する。
 * WebRTCの映像コーデックはアルファチャンネルを運べないため、
 * 左半分にカラー、右半分にアルファマスクを並べて1枚にパッキングする。
 */
export class AvatarStreamer {
  readonly canvas: HTMLCanvasElement
  private readonly renderer: THREE.WebGLRenderer
  private readonly camera: THREE.OrthographicCamera
  private readonly maskMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff })
  private accum = 0

  constructor() {
    this.canvas = document.createElement('canvas')
    this.canvas.width = CAPTURE_PX_W * 2
    this.canvas.height = CAPTURE_PX_H

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true })
    this.renderer.setClearColor(0x000000, 1)
    this.renderer.setScissorTest(true)

    this.camera = new THREE.OrthographicCamera(
      -CAPTURE_WORLD_W / 2,
      CAPTURE_WORLD_W / 2,
      CAPTURE_WORLD_H / 2,
      -CAPTURE_WORLD_H / 2,
      0.1,
      100,
    )
    this.camera.layers.set(AVATAR_LAYER)
  }

  captureTrack(): MediaStreamTrack {
    return this.canvas.captureStream(CAPTURE_FPS).getVideoTracks()[0]
  }

  update(delta: number, scene: THREE.Scene, avatarPos: THREE.Vector3, viewDir: THREE.Vector3) {
    this.accum += delta
    if (this.accum < 1 / CAPTURE_FPS) return
    this.accum %= 1 / CAPTURE_FPS

    const target = avatarPos.clone()
    target.y += CAPTURE_CENTER_Y
    this.camera.position.copy(target).addScaledVector(viewDir, 20)
    this.camera.lookAt(target)

    const background = scene.background
    scene.background = null

    // 左: カラー
    this.renderer.setViewport(0, 0, CAPTURE_PX_W, CAPTURE_PX_H)
    this.renderer.setScissor(0, 0, CAPTURE_PX_W, CAPTURE_PX_H)
    this.renderer.render(scene, this.camera)

    // 右: アルファマスク(白シルエット)
    this.renderer.setViewport(CAPTURE_PX_W, 0, CAPTURE_PX_W, CAPTURE_PX_H)
    this.renderer.setScissor(CAPTURE_PX_W, 0, CAPTURE_PX_W, CAPTURE_PX_H)
    scene.overrideMaterial = this.maskMaterial
    this.renderer.render(scene, this.camera)
    scene.overrideMaterial = null

    scene.background = background
  }

  dispose(): void {
    this.renderer.dispose()
  }
}
