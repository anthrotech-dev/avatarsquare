import * as THREE from 'three'
import { CAPTURE_CENTER_Y, CAPTURE_WORLD_H, CAPTURE_WORLD_W } from '../avatar/captureSpec'
import type { PosMessage } from '../net/protocol'

const LERP_SPEED = 12

/**
 * サイドバイサイドにパッキングされた映像(左:カラー/右:アルファ)を
 * 透過合成して表示するシェーダ。
 */
const billboardMaterial = (texture: THREE.VideoTexture) =>
  new THREE.ShaderMaterial({
    uniforms: { map: { value: texture } },
    transparent: true,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      varying vec2 vUv;
      void main() {
        vec3 color = texture2D(map, vec2(vUv.x * 0.5, vUv.y)).rgb;
        float alpha = texture2D(map, vec2(0.5 + vUv.x * 0.5, vUv.y)).r;
        if (alpha < 0.05) discard;
        gl_FragColor = vec4(color, alpha);
      }
    `,
  })

class RemoteAvatar {
  readonly group = new THREE.Group()
  readonly target = new THREE.Vector3()
  private readonly plane: THREE.Mesh
  private video: HTMLVideoElement | null = null

  constructor() {
    this.plane = new THREE.Mesh(new THREE.PlaneGeometry(CAPTURE_WORLD_W, CAPTURE_WORLD_H))
    this.plane.position.y = CAPTURE_CENTER_Y
    this.plane.visible = false // 映像が届くまで非表示
    this.group.add(this.plane)

    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.42, 24),
      new THREE.MeshBasicMaterial({ color: 0x1e321e, transparent: true, opacity: 0.35 }),
    )
    shadow.rotation.x = -Math.PI / 2
    shadow.scale.y = 0.7
    shadow.position.y = 0.03
    this.group.add(shadow)
  }

  setVideo(video: HTMLVideoElement): void {
    this.video = video
    const texture = new THREE.VideoTexture(video)
    texture.colorSpace = THREE.SRGBColorSpace
    this.plane.material = billboardMaterial(texture)
    this.plane.visible = true
  }

  update(delta: number, cameraQuaternion: THREE.Quaternion): void {
    this.group.position.lerp(this.target, Math.min(1, LERP_SPEED * delta))
    // 送信側のキャプチャと同じ向き(=画面と平行)で再投影する
    this.plane.quaternion.copy(cameraQuaternion)
  }

  dispose(): void {
    this.plane.geometry.dispose()
    ;(this.plane.material as THREE.Material).dispose()
    this.video?.remove()
  }
}

/** リモート参加者のアバター表示を管理する */
export class RemoteAvatars {
  private readonly avatars = new Map<string, RemoteAvatar>()

  constructor(private readonly scene: THREE.Scene) {}

  applyMessage(id: string, message: PosMessage): void {
    const avatar = this.getOrCreate(id)
    avatar.target.set(message.x, 0, message.z)
  }

  setVideo(id: string, video: HTMLVideoElement): void {
    this.getOrCreate(id).setVideo(video)
  }

  remove(id: string): void {
    const avatar = this.avatars.get(id)
    if (!avatar) return
    this.scene.remove(avatar.group)
    avatar.dispose()
    this.avatars.delete(id)
  }

  update(delta: number, cameraQuaternion: THREE.Quaternion): void {
    for (const avatar of this.avatars.values()) avatar.update(delta, cameraQuaternion)
  }

  private getOrCreate(id: string): RemoteAvatar {
    let avatar = this.avatars.get(id)
    if (!avatar) {
      avatar = new RemoteAvatar()
      this.scene.add(avatar.group)
      this.avatars.set(id, avatar)
    }
    return avatar
  }
}
