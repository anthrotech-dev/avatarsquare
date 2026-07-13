import * as THREE from 'three'
import { CAPTURE_CENTER_Y, CAPTURE_WORLD_H, CAPTURE_WORLD_W } from '../avatar/captureSpec'
import type { PosMessage } from '../net/protocol'
import { Nameplate } from './nameplate'
import { BUBBLE_WORLD_H, SpeechBubble } from './speechBubble'

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
  /** ジャンプ中の高さ。ビルボード板だけ上げ、影は地面に残す */
  planeTargetY = CAPTURE_CENTER_Y
  private readonly plane: THREE.Mesh
  private readonly shadow: THREE.Mesh
  private nameplate: Nameplate | null = null
  private bubble: SpeechBubble | null = null
  private video: HTMLVideoElement | null = null

  constructor() {
    this.plane = new THREE.Mesh(new THREE.PlaneGeometry(CAPTURE_WORLD_W, CAPTURE_WORLD_H))
    this.plane.position.y = CAPTURE_CENTER_Y
    this.plane.visible = false // 映像が届くまで非表示
    this.group.add(this.plane)

    this.shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.42, 24),
      new THREE.MeshBasicMaterial({ color: 0x1e321e, transparent: true, opacity: 0.35 }),
    )
    this.shadow.rotation.x = -Math.PI / 2
    this.shadow.scale.y = 0.7
    this.shadow.position.y = 0.03
    this.group.add(this.shadow)
  }

  /** 頭上のネームプレート。空文字で非表示 */
  setName(name: string): void {
    if (!this.nameplate) {
      if (!name) return
      this.nameplate = new Nameplate(name)
      // planeの子にするとカメラ正対回転で位置がずれるためgroup直下に置き、update()でy追従
      this.group.add(this.nameplate.sprite)
      return
    }
    this.nameplate.setText(name)
  }

  /** チャット発言を頭上の吹き出しに表示する。nameplateと同じくgroup直下+update()でy追従 */
  say(text: string): void {
    if (!this.bubble) {
      this.bubble = new SpeechBubble()
      this.group.add(this.bubble.sprite)
    }
    this.bubble.show(text)
  }

  setVideo(video: HTMLVideoElement): void {
    this.video = video
    const texture = new THREE.VideoTexture(video)
    texture.colorSpace = THREE.SRGBColorSpace
    this.plane.material = billboardMaterial(texture)
    this.plane.visible = true
  }

  update(delta: number, cameraQuaternion: THREE.Quaternion): void {
    const t = Math.min(1, LERP_SPEED * delta)
    this.group.position.lerp(this.target, t)
    this.plane.position.y += (this.planeTargetY - this.plane.position.y) * t
    // 送信側のキャプチャと同じ向き(=画面と平行)で再投影する
    this.plane.quaternion.copy(cameraQuaternion)
    // ネームプレート(高さ0.35)、その上に吹き出し。名前がない相手でも同じ高さに出す
    const plateY = this.plane.position.y + CAPTURE_WORLD_H / 2 + 0.15
    if (this.nameplate) {
      this.nameplate.sprite.position.y = plateY
    }
    if (this.bubble) {
      this.bubble.sprite.position.y = plateY + 0.35 / 2 + 0.05 + BUBBLE_WORLD_H / 2
      this.bubble.update(delta)
    }
  }

  dispose(): void {
    this.plane.geometry.dispose()
    ;(this.plane.material as THREE.Material).dispose()
    this.shadow.geometry.dispose()
    ;(this.shadow.material as THREE.Material).dispose()
    this.nameplate?.dispose()
    this.bubble?.dispose()
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
    avatar.planeTargetY = CAPTURE_CENTER_Y + (message.y ?? 0)
  }

  setVideo(id: string, video: HTMLVideoElement): void {
    this.getOrCreate(id).setVideo(video)
  }

  setName(id: string, name: string): void {
    this.getOrCreate(id).setName(name)
  }

  say(id: string, text: string): void {
    this.getOrCreate(id).say(text)
  }

  clear(): void {
    for (const id of [...this.avatars.keys()]) this.remove(id)
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
