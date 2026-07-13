import type { VRM } from '@pixiv/three-vrm'
import {
  createVRMAnimationClip,
  type VRMAnimation,
  VRMAnimationLoaderPlugin,
} from '@pixiv/three-vrm-animation'
import * as THREE from 'three'
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { mixamoVRMRigMap } from './mixamoVRMRigMap'

/** VRM Animation形式(.vrma)を読み込み、対象VRM用のクリップに変換する */
export async function loadVRMAClip(data: ArrayBuffer, vrm: VRM): Promise<THREE.AnimationClip> {
  const loader = new GLTFLoader()
  loader.register((parser) => new VRMAnimationLoaderPlugin(parser))
  const gltf = await loader.parseAsync(data, '')
  const animations = gltf.userData.vrmAnimations as VRMAnimation[] | undefined
  if (!animations || animations.length === 0) {
    throw new Error('VRMアニメーションが含まれていません')
  }
  return createVRMAnimationClip(animations[0], vrm)
}

/**
 * Mixamo等のFBXアニメーションをVRMヒューマノイドへリターゲットする。
 * three-vrm公式サンプル(loadMixamoAnimation)の移植。
 * Unity向けに配布されているMixamoリグのモーションがそのまま使える。
 */
export function loadMixamoClip(data: ArrayBuffer, vrm: VRM): THREE.AnimationClip {
  const loader = new FBXLoader()
  const asset = loader.parse(data, '')

  const clip = THREE.AnimationClip.findByName(asset.animations, 'mixamo.com') ?? asset.animations[0]
  if (!clip) throw new Error('FBXにアニメーションが含まれていません')

  const mixamoHips = asset.getObjectByName('mixamorigHips')
  if (!mixamoHips) throw new Error('Mixamoリグ(mixamorigHips)が見つかりません')

  const tracks: THREE.KeyframeTrack[] = []
  const restRotationInverse = new THREE.Quaternion()
  const parentRestWorldRotation = new THREE.Quaternion()
  const _quat = new THREE.Quaternion()
  const _vec3 = new THREE.Vector3()

  // 身長差を吸収するためのスケール(腰の高さ比)
  const motionHipsHeight = mixamoHips.position.y
  const vrmHipsNode = vrm.humanoid.getNormalizedBoneNode('hips')
  if (!vrmHipsNode) throw new Error('VRMにhipsボーンがありません')
  const vrmHipsY = vrmHipsNode.getWorldPosition(_vec3).y
  const vrmRootY = vrm.scene.getWorldPosition(_vec3).y
  const vrmHipsHeight = Math.abs(vrmHipsY - vrmRootY)
  const hipsPositionScale = motionHipsHeight > 0 ? vrmHipsHeight / motionHipsHeight : 1

  const isVRM0 = vrm.meta.metaVersion === '0'

  for (const track of clip.tracks) {
    const [mixamoRigName, propertyName] = track.name.split('.')
    const vrmBoneName = mixamoVRMRigMap[mixamoRigName]
    if (!vrmBoneName) continue
    const vrmNodeName = vrm.humanoid.getNormalizedBoneNode(vrmBoneName)?.name
    const mixamoRigNode = asset.getObjectByName(mixamoRigName)
    if (!vrmNodeName || !mixamoRigNode?.parent) continue

    mixamoRigNode.getWorldQuaternion(restRotationInverse).invert()
    mixamoRigNode.parent.getWorldQuaternion(parentRestWorldRotation)

    if (track instanceof THREE.QuaternionKeyframeTrack) {
      // レスト姿勢の差分を吸収してワールド回転をVRM側ローカルへ変換
      const values = new Float32Array(track.values.length)
      for (let i = 0; i < track.values.length; i += 4) {
        _quat.fromArray(track.values, i)
        _quat.premultiply(parentRestWorldRotation).multiply(restRotationInverse)
        _quat.toArray(values, i)
      }
      // VRM0は座標系が180度反転している
      if (isVRM0) {
        for (let i = 0; i < values.length; i += 2) values[i] = -values[i]
      }
      tracks.push(
        new THREE.QuaternionKeyframeTrack(`${vrmNodeName}.quaternion`, [...track.times], values),
      )
    } else if (track instanceof THREE.VectorKeyframeTrack && propertyName === 'position') {
      const values = Float32Array.from(track.values, (v, i) => {
        const flipped = isVRM0 && i % 3 !== 1 ? -v : v
        return flipped * hipsPositionScale
      })
      tracks.push(
        new THREE.VectorKeyframeTrack(`${vrmNodeName}.position`, [...track.times], values),
      )
    }
  }

  if (tracks.length === 0) throw new Error('変換できるトラックがありませんでした')
  return new THREE.AnimationClip('mixamo', clip.duration, tracks)
}

export type AnimationFileKind = 'vrma' | 'fbx'

export function animationKindFromFilename(filename: string): AnimationFileKind | null {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.vrma')) return 'vrma'
  if (lower.endsWith('.fbx')) return 'fbx'
  return null
}

export async function loadAnimationClip(
  data: ArrayBuffer,
  kind: AnimationFileKind,
  vrm: VRM,
): Promise<THREE.AnimationClip> {
  return kind === 'vrma' ? loadVRMAClip(data, vrm) : loadMixamoClip(data, vrm)
}

/** viteのSPAフォールバック(index.htmlが200で返る)を誤読しないための簡易判定 */
export function looksLikeAnimationFile(data: ArrayBuffer, kind: AnimationFileKind): boolean {
  const head = new Uint8Array(data.slice(0, 20))
  const text = String.fromCharCode(...head)
  if (kind === 'vrma') return text.startsWith('glTF')
  return text.startsWith('Kaydara') || text.includes('FBX')
}
