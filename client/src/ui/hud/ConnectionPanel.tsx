import { useAppStore } from '../../state/store'

/** サーバー接続状態と参加人数の表示(デフォルトはステータス直下) */
export function ConnectionPanel() {
  const netStatus = useAppStore((s) => s.netStatus)
  const peers = useAppStore((s) => s.peers)
  return (
    <div className="hud-connection">
      <div className="hud-connection-line">
        {netStatus} / 他{peers}人
      </div>
    </div>
  )
}
