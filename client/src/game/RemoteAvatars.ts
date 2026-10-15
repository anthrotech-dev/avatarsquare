import * as THREE from 'three'
import { CAPTURE_CENTER_Y, CAPTURE_WORLD_H, CAPTURE_WORLD_W } from '../avatar/captureSpec'
import type { PosMessage, VoiceMode } from '../net/protocol'
import type { PeerVoiceState } from '../net/VoiceChat'
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
  // ネームプレートはprofile受信まで生成されないため、VC状態は保持して生成時に適用する
  private voiceState: PeerVoiceState = 'off'
  private voiceMode: VoiceMode = 'normal'
  private speaking = false
  /** 表示名(profile受信前は空)。ターゲットHUDの名前解決に使う */
  name = ''
  /** 戦闘不能中(posのdeadフラグ)。ターゲットHUDのグレー表示と回復対象の判定に使う */
  dead = false

  constructor(id: string) {
    // レイキャストのヒットから参加者idへ解決するためgroupに刻む(子はこれを祖先に持つ)
    this.group.userData.peerId = id
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
    this.name = name
    if (!this.nameplate) {
      if (!name) return
      this.nameplate = new Nameplate(name)
      this.nameplate.setVoiceState(this.voiceState)
      this.nameplate.setVoiceMode(this.voiceMode)
      this.nameplate.setSpeaking(this.speaking)
      // planeの子にするとカメラ正対回転で位置がずれるためgroup直下に置き、update()でy追従
      this.group.add(this.nameplate.sprite)
      return
    }
    this.nameplate.setText(name)
  }

  setVoiceState(state: PeerVoiceState): void {
    this.voiceState = state
    this.nameplate?.setVoiceState(state)
  }

  setVoiceMode(mode: VoiceMode): void {
    this.voiceMode = mode
    this.nameplate?.setVoiceMode(mode)
  }

  setSpeaking(speaking: boolean): void {
    this.speaking = speaking
    this.nameplate?.setSpeaking(speaking)
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
    // 再接続などでトラックが差し替わったとき、旧映像リソースを確実に手放す
    // (放置するとvideoのデコードとVRAMがリークする)
    if (this.video && this.video !== video) {
      this.video.pause()
      this.video.srcObject = null
      this.video.remove()
      this.disposeVideoMaterial()
    }
    this.video = video
    const texture = new THREE.VideoTexture(video)
    texture.colorSpace = THREE.SRGBColorSpace
    this.plane.material = billboardMaterial(texture)
    this.plane.visible = true
  }

  /** planeがビデオ用ShaderMaterialを持っていればテクスチャごと破棄する */
  private disposeVideoMaterial(): void {
    const material = this.plane.material
    if (material instanceof THREE.ShaderMaterial) {
      ;(material.uniforms.map?.value as THREE.Texture | undefined)?.dispose()
      material.dispose()
    }
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
    this.disposeVideoMaterial()
    this.shadow.geometry.dispose()
    ;(this.shadow.material as THREE.Material).dispose()
    this.nameplate?.dispose()
    this.bubble?.dispose()
    if (this.video) {
      this.video.pause()
      this.video.srcObject = null
      this.video.remove()
    }
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
    avatar.dead = message.dead === true
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

  /** VC状態(ネームプレートのアイコン)。posより先に届き得るため保持目的で生成する */
  setVoiceState(id: string, state: PeerVoiceState): void {
    this.getOrCreate(id).setVoiceState(state)
  }

  /** 発音モード(ネームプレートのアイコン)。voiceState同様に保持目的で生成する */
  setVoiceMode(id: string, mode: VoiceMode): void {
    this.getOrCreate(id).setVoiceMode(mode)
  }

  /** 発話中表示。頻繁に切り替わる一過性の状態なので、いない相手は無視する */
  setSpeaking(id: string, speaking: boolean): void {
    this.avatars.get(id)?.setSpeaking(speaking)
  }

  /** 補間済みの表示位置(選択リングの追従用)。いない相手はnull */
  position(id: string): THREE.Vector3 | null {
    return this.avatars.get(id)?.group.position ?? null
  }

  /** 表示名(profile未受信なら空文字)。いない相手はnull */
  nameOf(id: string): string | null {
    const avatar = this.avatars.get(id)
    return avatar ? avatar.name : null
  }

  has(id: string): boolean {
    return this.avatars.has(id)
  }

  /** 戦闘不能中か。いない相手はfalse */
  isDead(id: string): boolean {
    return this.avatars.get(id)?.dead === true
  }

  /**
   * クリック選択のレイキャスト対象(各参加者のgroup。子はintersectObjectsのrecursiveで拾う)。
   * ヒットしたオブジェクトからはuserData.peerIdを持つ祖先を辿って参加者idへ解決する
   */
  raycastTargets(): THREE.Object3D[] {
    return [...this.avatars.values()].map((avatar) => avatar.group)
  }

  /** 空間音響の音源位置に使う、補間済みの表示位置(id, position)の列挙 */
  *positions(): IterableIterator<[string, THREE.Vector3]> {
    for (const [id, avatar] of this.avatars) yield [id, avatar.group.position]
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
      avatar = new RemoteAvatar(id)
      this.scene.add(avatar.group)
      this.avatars.set(id, avatar)
    }
    return avatar
  }
}
