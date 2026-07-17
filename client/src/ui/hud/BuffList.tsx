import { useEffect, useState } from 'react'
import type { BuffInfo } from '../../game/buffs'

/**
 * バフ・デバフのチップ一覧(表示専用)。自分(SelfBuffsPanel)とターゲット
 * (TargetBuffsPanel)で共有する。残り時間はexpiresAtからクライアント時計で
 * カウントダウンし、期限切れは剥奪patchの受信を待たず表示から除外する
 */
export function BuffList({ buffs }: { buffs: BuffInfo[] }) {
  const hasTimed = buffs.some((b) => b.expiresAt !== null)
  const [, setTick] = useState(0)
  // 時限バフがあるときだけ200ms間隔で再レンダして残り秒を進める
  useEffect(() => {
    if (!hasTimed) return
    const timer = setInterval(() => setTick((n) => n + 1), 200)
    return () => clearInterval(timer)
  }, [hasTimed])

  const now = performance.now()
  const visible = buffs.filter((b) => b.expiresAt === null || b.expiresAt > now)
  if (visible.length === 0) return null
  return (
    <div className="hud-bufflist">
      {visible.map((b) => (
        <span key={b.id} className={`hud-buff hud-buff-${b.kind}`} title={b.name}>
          {b.name}
          {b.expiresAt !== null && (
            <span className="hud-buff-time">{Math.ceil((b.expiresAt - now) / 1000)}</span>
          )}
        </span>
      ))}
    </div>
  )
}
