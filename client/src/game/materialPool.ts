import * as THREE from 'three'

/**
 * エフェクト・マーカー用フラットマテリアルのプール。
 * disposeするとthree.jsのプログラムキャッシュ(マテリアル参照カウント式)から
 * コンパイル済みシェーダーが消え、次の生成で再コンパイル+同期ストール
 * (getProgramInfoLog等)が起きてフレームレートが大きく落ちる。
 * そのためdisposeせず色ごとに使い回し、プログラムを生かし続ける。
 */

const pool = new Map<number, THREE.MeshBasicMaterial[]>()

export function acquireFlatMaterial(color: number): THREE.MeshBasicMaterial {
  const reused = pool.get(color)?.pop()
  if (reused) {
    reused.opacity = 1
    return reused
  }
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
  })
}

/** disposeの代わりに呼ぶ。マテリアルはプールに戻り再利用される */
export function releaseFlatMaterial(material: THREE.MeshBasicMaterial): void {
  const key = material.color.getHex()
  const stack = pool.get(key)
  if (stack) stack.push(material)
  else pool.set(key, [material])
}
