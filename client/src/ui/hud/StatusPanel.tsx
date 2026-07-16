import { useAppStore } from '../../state/store'

/** 左上のステータス表示。アバター名・HP・現在位置・接続状態 */
export function StatusPanel() {
  const avatarName = useAppStore((s) => s.avatarName)
  const status = useAppStore((s) => s.status)
  const netStatus = useAppStore((s) => s.netStatus)
  const peers = useAppStore((s) => s.peers)
  const position = useAppStore((s) => s.position)
  const selfHp = useAppStore((s) => s.selfHp)
  const selfHpMax = useAppStore((s) => s.selfHpMax)

  const ratio = selfHpMax > 0 ? Math.max(0, Math.min(1, selfHp / selfHpMax)) : 0
  // ゲージ色はターゲットパネル・ワールド空間のbarと同じ閾値
  const color = ratio > 0.5 ? '#7cfc8a' : ratio > 0.25 ? '#ffd25e' : '#ff6b5e'

  return (
    <div className="hud-status">
      <div className="hud-status-name">{avatarName ?? 'アバター未読込'}</div>
      <div className="hud-status-hpbar">
        <div
          className="hud-status-hpfill"
          style={{ width: `${ratio * 100}%`, background: color }}
        />
        <span className="hud-status-hptext">
          {selfHp} / {selfHpMax}
        </span>
      </div>
      <div className="hud-status-line">
        ({position.x.toFixed(1)}, {position.z.toFixed(1)})
      </div>
      <div className="hud-status-line">
        {netStatus} / 他{peers}人
      </div>
      {status && <div className="hud-status-message">{status}</div>}
    </div>
  )
}
