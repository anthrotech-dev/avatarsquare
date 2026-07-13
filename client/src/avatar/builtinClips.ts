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
