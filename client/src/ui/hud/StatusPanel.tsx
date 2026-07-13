import { useAppStore } from '../../state/store'

/** 左上のステータス表示。アバター名・現在位置・接続状態 */
export function StatusPanel() {
  const avatarName = useAppStore((s) => s.avatarName)
  const status = useAppStore((s) => s.status)
  const netStatus = useAppStore((s) => s.netStatus)
  const peers = useAppStore((s) => s.peers)
  const position = useAppStore((s) => s.position)

  return (
    <div className="hud-status">
      <div className="hud-status-name">{avatarName ?? 'アバター未読込'}</div>
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
