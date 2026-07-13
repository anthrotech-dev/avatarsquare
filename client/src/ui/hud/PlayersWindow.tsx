import { useAppStore } from '../../state/store'
import { FloatingWindow } from './FloatingWindow'

/**
 * 今この部屋にいるプレイヤーの一覧。/players(メニュー・ホットバー)から開く。
 * 自分+リモート参加者を表示する。名前未設定の相手はidで表示
 */
export function PlayersWindow() {
  const setPlayersOpen = useAppStore((s) => s.setPlayersOpen)
  const players = useAppStore((s) => s.players)
  const selfId = useAppStore((s) => s.selfId)
  const playerName = useAppStore((s) => s.playerName)
  const avatarName = useAppStore((s) => s.avatarName)

  const selfName = playerName || avatarName || selfId || '(未接続)'
  const sorted = [...players].sort((a, b) =>
    (a.name || a.id).localeCompare(b.name || b.id, 'ja'),
  )

  return (
    <FloatingWindow
      title={`プレイヤー一覧 (${players.length + (selfId ? 1 : 0)}人)`}
      onClose={() => setPlayersOpen(false)}
      initialPos={{ x: window.innerWidth / 2 - 190, y: window.innerHeight / 2 - 200 }}
    >
      <div className="hud-players">
        <div className="hud-players-row">
          <span className="hud-players-name">{selfName}</span>
          <span className="hud-players-self">自分</span>
        </div>
        {sorted.map((player) => (
          <div key={player.id} className="hud-players-row">
            <span className="hud-players-name">{player.name || player.id}</span>
            {player.name && <span className="hud-players-id">{player.id}</span>}
          </div>
        ))}
        {players.length === 0 && (
          <div className="hud-players-empty">ほかのプレイヤーはいません</div>
        )}
      </div>
    </FloatingWindow>
  )
}
