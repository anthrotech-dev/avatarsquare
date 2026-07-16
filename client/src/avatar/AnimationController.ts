import type { VRM } from '@pixiv/three-vrm'
import * as THREE from 'three'

const CROSS_FADE = 0.25
const ONESHOT_FADE = 0.15

/**
 * 名前付きAnimationClipを管理し、ループ(idle/walk)とワンショット
 * (攻撃・エモート等)をクロスフェードで切り替える。
 * クリップの出所(組み込み生成 / VRMA / Mixamo FBX)は問わない。
 */
export class AnimationController {
  private readonly mixer: THREE.AnimationMixer
  private readonly clips = new Map<string, THREE.AnimationClip>()
  private currentAction: THREE.AnimationAction | null = null
  private currentName: string | null = null
  private desiredLoop: string | null = null
  private oneShot: THREE.AnimationAction | null = null

  constructor(vrm: VRM) {
    this.mixer = new THREE.AnimationMixer(vrm.scene)
  }

  has(name: string): boolean {
    return this.clips.has(name)
  }

  /** クリップを登録する。同名クリップは差し替え(再生中なら即座に反映) */
  register(name: string, clip: THREE.AnimationClip): void {
    const old = this.clips.get(name)
    const wasCurrent = this.currentName === name
    if (old) {
      this.mixer.uncacheClip(old)
      if (wasCurrent) {
        this.currentAction = null
        this.currentName = null
      }
    }
    clip.name = name
    this.clips.set(name, clip)
    if (wasCurrent) this.playLoopInternal(name)
  }

  /** ループ再生したい状態(idle/walk)を指定する。ワンショット再生中は終了後に反映 */
  setLocomotion(name: string): void {
    this.desiredLoop = name
    if (this.oneShot) return
    this.playLoopInternal(name)
  }

  /** 攻撃・エモートなどを1回再生し、終わったらロコモーションに戻る */
  playOnce(name: string): void {
    const clip = this.clips.get(name)
    if (!clip) return

    if (this.oneShot) {
      this.oneShot.fadeOut(ONESHOT_FADE)
      this.oneShot = null
    }

    const action = this.mixer.clipAction(clip)
    action.reset()
    action.setLoop(THREE.LoopOnce, 1)
    action.clampWhenFinished = true
    this.currentAction?.fadeOut(ONESHOT_FADE)
    this.currentAction = null
    this.currentName = null
    action.fadeIn(ONESHOT_FADE).play()
    this.oneShot = action

    const onFinished = (event: { action: THREE.AnimationAction }) => {
      if (event.action !== action) return
      this.mixer.removeEventListener('finished', onFinished)
      action.fadeOut(CROSS_FADE)
      if (this.oneShot === action) this.oneShot = null
      if (this.desiredLoop) this.playLoopInternal(this.desiredLoop)
    }
    this.mixer.addEventListener('finished', onFinished)
  }

  /**
   * クリップを1回再生し、最終フレームで静止し続ける(戦闘不能など)。
   * releaseHoldするまでロコモーションに戻らない。
   */
  playHold(name: string): void {
    const clip = this.clips.get(name)
    if (!clip) return

    if (this.oneShot) {
      this.oneShot.fadeOut(ONESHOT_FADE)
      this.oneShot = null
    }

    const action = this.mixer.clipAction(clip)
    action.reset()
    action.setLoop(THREE.LoopOnce, 1)
    action.clampWhenFinished = true
    this.currentAction?.fadeOut(ONESHOT_FADE)
    this.currentAction = null
    this.currentName = null
    action.fadeIn(ONESHOT_FADE).play()
    // finishedリスナーを付けずoneShotを保持し続ける=setLocomotionが上書きしない
    this.oneShot = action
  }

  /** playHoldの解除。ロコモーション(desiredLoop)へ復帰する */
  releaseHold(): void {
    if (!this.oneShot) return
    this.oneShot.fadeOut(CROSS_FADE)
    this.oneShot = null
    if (this.desiredLoop) this.playLoopInternal(this.desiredLoop)
  }

  update(delta: number): void {
    this.mixer.update(delta)
  }

  dispose(): void {
    this.mixer.stopAllAction()
  }

  private playLoopInternal(name: string): void {
    if (this.currentName === name) return
    const clip = this.clips.get(name)
    if (!clip) return
    const action = this.mixer.clipAction(clip)
    action.reset()
    action.setLoop(THREE.LoopRepeat, Infinity)
    action.fadeIn(CROSS_FADE).play()
    this.currentAction?.fadeOut(CROSS_FADE)
    this.currentAction = action
    this.currentName = name
  }
}
