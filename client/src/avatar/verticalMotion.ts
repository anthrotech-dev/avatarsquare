/**
 * ジャンプの鉛直運動。マップは平坦なので地面は常にy=0。
 * 重力は現実より強めにして、ゲーム的なキビキビした跳躍にする。
 */

export const GRAVITY = 9.8 * 2
export const JUMP_SPEED = 6.3 // m/s。最高到達 v^2/2g ≈ 1.0m、滞空 2v/g ≈ 0.64s

export interface VerticalState {
  y: number
  vy: number
}

export interface VerticalStep extends VerticalState {
  /** このステップで着地したか */
  landed: boolean
}

export function isAirborne(state: VerticalState): boolean {
  return state.y > 0 || state.vy !== 0
}

export function stepVertical(state: VerticalState, delta: number): VerticalStep {
  if (!isAirborne(state)) return { y: 0, vy: 0, landed: false }
  const vy = state.vy - GRAVITY * delta
  const y = state.y + vy * delta
  if (y <= 0) return { y: 0, vy: 0, landed: true }
  return { y, vy, landed: false }
}
