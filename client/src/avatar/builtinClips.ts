import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm'
import * as THREE from 'three'

const ARM_REST_Z = 1.15 // 腕を下ろした基本ポーズ
const WALK_CYCLE = 0.55 // 2歩ぶんの周期(秒)。WALK_SPEEDとストライド0.85mに対応
const SAMPLES = 24

/**
 * アニメーション素材が無くても動くように、歩行と待機のクリップを
 * キーフレームとして生成する。外部素材(VRMA/FBX)を登録すれば差し替わる。
 */

type Sampler = (phase: number) => THREE.Euler

function boneTrack(
  vrm: VRM,
  bone: VRMHumanBoneName,
  duration: number,
  sampler: Sampler,
): THREE.QuaternionKeyframeTrack | null {
  const node = vrm.humanoid.getNormalizedBoneNode(bone)
  if (!node) return null
  // VRM0の正規化ボーン空間はVRM1に対してY軸180°回転しているため、
  // VRM1基準で作った回転をx,z反転で変換する(公式Mixamoローダーと同じ扱い)
  const isVRM0 = vrm.meta.metaVersion === '0'
  const times: number[] = []
  const values: number[] = []
  const quat = new THREE.Quaternion()
  for (let i = 0; i <= SAMPLES; i++) {
    const t = (i / SAMPLES) * duration
    const phase = (i / SAMPLES) * Math.PI * 2
    quat.setFromEuler(sampler(phase))
    times.push(t)
    if (isVRM0) {
      values.push(-quat.x, quat.y, -quat.z, quat.w)
    } else {
      values.push(quat.x, quat.y, quat.z, quat.w)
    }
  }
  return new THREE.QuaternionKeyframeTrack(`${node.name}.quaternion`, times, values)
}

function hipsBobTrack(vrm: VRM, duration: number, amount: number): THREE.KeyframeTrack | null {
  const hips = vrm.humanoid.getNormalizedBoneNode('hips')
  if (!hips) return null
  const base = hips.position
  const times: number[] = []
  const values: number[] = []
  for (let i = 0; i <= SAMPLES; i++) {
    const phase = (i / SAMPLES) * Math.PI * 2
    times.push((i / SAMPLES) * duration)
    values.push(base.x, base.y + (Math.cos(phase * 2) - 1) * amount, base.z)
  }
  return new THREE.VectorKeyframeTrack(`${hips.name}.position`, times, values)
}

export function buildWalkClip(vrm: VRM): THREE.AnimationClip {
  const d = WALK_CYCLE
  // 正規化ボーン空間では +X 回転が末端を後方へ振る
  const samplers: Array<[VRMHumanBoneName, Sampler]> = [
    ['leftUpperLeg', (p) => new THREE.Euler(-Math.sin(p) * 0.55, 0, 0)],
    ['rightUpperLeg', (p) => new THREE.Euler(Math.sin(p) * 0.55, 0, 0)],
    // 後ろにある脚の膝を少し遅れて曲げる
    ['leftLowerLeg', (p) => new THREE.Euler(Math.max(0, -Math.sin(p - 0.6)) * 0.7, 0, 0)],
    ['rightLowerLeg', (p) => new THREE.Euler(Math.max(0, Math.sin(p - 0.6)) * 0.7, 0, 0)],
    // 腕は同じ側の脚と逆位相。zは下ろした姿勢を維持
    ['leftUpperArm', (p) => new THREE.Euler(Math.sin(p) * 0.5, 0, -ARM_REST_Z)],
    ['rightUpperArm', (p) => new THREE.Euler(-Math.sin(p) * 0.5, 0, ARM_REST_Z)],
    ['spine', (p) => new THREE.Euler(0, Math.sin(p) * 0.06, 0)],
  ]
  const tracks = samplers
    .map(([bone, sampler]) => boneTrack(vrm, bone, d, sampler))
    .filter((t): t is THREE.QuaternionKeyframeTrack => t !== null)
  const bob = hipsBobTrack(vrm, d, 0.02)
  if (bob) tracks.push(bob)
  return new THREE.AnimationClip('walk', d, tracks)
}

// ワンショット用。phase(0..2π)を進行度0..1として扱う
const TAU = Math.PI * 2
const clamp01 = (t: number) => Math.min(1, Math.max(0, t))
const easeOut = (t: number) => 1 - (1 - t) ** 2

function oneShotClip(
  vrm: VRM,
  name: string,
  duration: number,
  samplers: Array<[VRMHumanBoneName, (p: number) => THREE.Euler]>,
): THREE.AnimationClip {
  const tracks = samplers
    .map(([bone, sampler]) => boneTrack(vrm, bone, duration, (phase) => sampler(phase / TAU)))
    .filter((t): t is THREE.QuaternionKeyframeTrack => t !== null)
  return new THREE.AnimationClip(name, duration, tracks)
}

export function buildJumpClip(vrm: VRM): THREE.AnimationClip {
  // 序盤に屈伸し、腕を振り上げながら伸び上がる
  const crouch = (p: number) => Math.sin(clamp01(p / 0.4) * Math.PI) * 0.9
  const raise = (p: number) => easeOut(clamp01((p - 0.15) / 0.35))
  return oneShotClip(vrm, 'jump', 0.5, [
    ['leftUpperLeg', (p) => new THREE.Euler(-crouch(p) * 0.8, 0, 0)],
    ['rightUpperLeg', (p) => new THREE.Euler(-crouch(p) * 0.8, 0, 0)],
    ['leftLowerLeg', (p) => new THREE.Euler(crouch(p) * 1.3, 0, 0)],
    ['rightLowerLeg', (p) => new THREE.Euler(crouch(p) * 1.3, 0, 0)],
    ['leftUpperArm', (p) => new THREE.Euler(-raise(p) * 1.1, 0, -ARM_REST_Z + raise(p) * 0.5)],
    ['rightUpperArm', (p) => new THREE.Euler(-raise(p) * 1.1, 0, ARM_REST_Z - raise(p) * 0.5)],
    ['spine', (p) => new THREE.Euler(crouch(p) * 0.15, 0, 0)],
  ])
}

export function buildSlashClip(vrm: VRM): THREE.AnimationClip {
  // 右腕を振りかぶって袈裟斬り
  const windup = (p: number) => easeOut(clamp01(p / 0.3))
  const swing = (p: number) => easeOut(clamp01((p - 0.3) / 0.25))
  return oneShotClip(vrm, 'slash', 0.45, [
    [
      'rightUpperArm',
      (p) =>
        new THREE.Euler(
          -2.2 * windup(p) + 2.7 * swing(p),
          -0.3 * windup(p) + 0.6 * swing(p),
          ARM_REST_Z - 0.8 * windup(p) + 0.4 * swing(p),
        ),
    ],
    ['rightLowerArm', (p) => new THREE.Euler(-0.8 * windup(p) + 0.8 * swing(p), 0, 0)],
    ['leftUpperArm', (p) => new THREE.Euler(0.3 * swing(p), 0, -ARM_REST_Z)],
    ['spine', (p) => new THREE.Euler(0.1 * swing(p), 0.35 * windup(p) - 0.7 * swing(p), 0)],
  ])
}

export function buildShootClip(vrm: VRM): THREE.AnimationClip {
  // 右腕を正面に突き出して撃つ。終盤に軽い反動
  const aim = (p: number) => easeOut(clamp01(p / 0.3))
  const recoil = (p: number) => Math.sin(clamp01((p - 0.5) / 0.4) * Math.PI) * 0.2
  return oneShotClip(vrm, 'shoot', 0.4, [
    [
      'rightUpperArm',
      (p) => new THREE.Euler(-1.35 * aim(p) + recoil(p), 0, ARM_REST_Z * (1 - 0.9 * aim(p))),
    ],
    ['rightLowerArm', (p) => new THREE.Euler(recoil(p) * 0.5, 0, 0)],
    ['spine', (p) => new THREE.Euler(-recoil(p) * 0.3, -0.25 * aim(p), 0)],
  ])
}

/** アクション用フォールバッククリップ一式。外部素材を登録すれば差し替わる */
export function buildActionClips(vrm: VRM): Array<[string, THREE.AnimationClip]> {
  return [
    ['jump', buildJumpClip(vrm)],
    ['slash', buildSlashClip(vrm)],
    ['shoot', buildShootClip(vrm)],
  ]
}

export function buildIdleClip(vrm: VRM): THREE.AnimationClip {
  const d = 4
  const samplers: Array<[VRMHumanBoneName, Sampler]> = [
    ['leftUpperLeg', () => new THREE.Euler(0, 0, 0)],
    ['rightUpperLeg', () => new THREE.Euler(0, 0, 0)],
    ['leftLowerLeg', () => new THREE.Euler(0, 0, 0)],
    ['rightLowerLeg', () => new THREE.Euler(0, 0, 0)],
    // 呼吸で腕がわずかに揺れる
    ['leftUpperArm', (p) => new THREE.Euler(0, 0, -ARM_REST_Z + Math.sin(p) * 0.015)],
    ['rightUpperArm', (p) => new THREE.Euler(0, 0, ARM_REST_Z - Math.sin(p) * 0.015)],
    ['chest', (p) => new THREE.Euler(Math.sin(p) * 0.012, 0, 0)],
    ['spine', () => new THREE.Euler(0, 0, 0)],
  ]
  const tracks = samplers
    .map(([bone, sampler]) => boneTrack(vrm, bone, d, sampler))
    .filter((t): t is THREE.QuaternionKeyframeTrack => t !== null)
  const bob = hipsBobTrack(vrm, d, 0)
  if (bob) tracks.push(bob)
  return new THREE.AnimationClip('idle', d, tracks)
}
