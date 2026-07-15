import { useAppStore } from '../../state/store'
import { FloatingWindow } from './FloatingWindow'

/**
 * ボイスチャットウィンドウ。/voice(メニュー・VCパネル)から開く。
 * VC/マイクの切替、マスター音量、参加者一覧(発話中・VC状態・個別音量)を扱う。
 * VC/マイク操作はコマンド経由、音量はstore経由(GameがVoiceChatへ流す)。
 */
export function VoiceWindow() {
  const setVoiceOpen = useAppStore((s) => s.setVoiceOpen)
  const dispatch = useAppStore((s) => s.dispatch)
  const voiceEnabled = useAppStore((s) => s.voiceEnabled)
  const micMuted = useAppStore((s) => s.micMuted)
  const speakingIds = useAppStore((s) => s.speakingIds)
  const voicePeers = useAppStore((s) => s.voicePeers)
  const playerVolumes = useAppStore((s) => s.playerVolumes)
  const setPlayerVolume = useAppStore((s) => s.setPlayerVolume)
  const voiceMasterVolume = useAppStore((s) => s.voiceMasterVolume)
  const setVoiceMasterVolume = useAppStore((s) => s.setVoiceMasterVolume)
  const players = useAppStore((s) => s.players)
  const selfId = useAppStore((s) => s.selfId)
  const playerName = useAppStore((s) => s.playerName)
  const avatarName = useAppStore((s) => s.avatarName)
  const voiceMode = useAppStore((s) => s.voiceMode)
  const whisperRadius = useAppStore((s) => s.whisperRadius)
  const voicePeerModes = useAppStore((s) => s.voicePeerModes)

  const selfName = playerName || avatarName || selfId || '(未接続)'
  const modeIcon = (mode?: 'broadcast' | 'whisper') =>
    mode === 'broadcast' ? '📢' : mode === 'whisper' ? '🤫' : '🎤'
  const selfState = !voiceEnabled
    ? null
    : micMuted
      ? '🔇'
      : modeIcon(voiceMode === 'normal' ? undefined : voiceMode)
  const sorted = [...players].sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id, 'ja'))

  return (
    <FloatingWindow
      title="ボイスチャット"
      onClose={() => setVoiceOpen(false)}
      initialPos={{ x: window.innerWidth / 2 - 190, y: window.innerHeight / 2 - 220 }}
    >
      <div className="hud-voice">
        <div className="hud-voice-controls">
          <button type="button" onClick={() => void dispatch?.('/vc toggle')}>
            {voiceEnabled ? 'VCから離脱' : 'VCに参加'}
          </button>
          <button
            type="button"
            disabled={!voiceEnabled}
            onClick={() => void dispatch?.('/mic toggle')}
          >
            {micMuted ? 'ミュート解除' : 'ミュート'}
          </button>
        </div>
        <div className="hud-voice-modes">
          <span className="hud-voice-volume-label">発音モード</span>
          <button
            type="button"
            className={voiceMode === 'normal' ? 'active' : ''}
            title="距離に応じて聞こえる通常の発話"
            onClick={() => void dispatch?.('/vc mode normal')}
          >
            通常
          </button>
          <button
            type="button"
            className={voiceMode === 'broadcast' ? 'active' : ''}
            title="距離に関係なく全員に届く"
            onClick={() => void dispatch?.('/vc mode broadcast')}
          >
            📢 拡声
          </button>
          <button
            type="button"
            className={voiceMode === 'whisper' ? 'active' : ''}
            title={`周囲${whisperRadius}mの円の中の人にだけ聞こえる(/whisper <半径>で変更)`}
            onClick={() => void dispatch?.('/vc mode whisper')}
          >
            🤫 ささやき
          </button>
        </div>
        <div className="hud-voice-volume">
          <span className="hud-voice-volume-label">全体音量</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={voiceMasterVolume}
            onChange={(e) => setVoiceMasterVolume(Number(e.target.value))}
          />
        </div>
        {!voiceEnabled && (
          <div className="hud-voice-hint">VCに参加すると他の人の声が聞こえるようになります</div>
        )}
        <div className="hud-voice-list">
          <div className="hud-voice-row">
            <span
              className={`hud-voice-dot ${selfId && speakingIds.includes(selfId) ? 'speaking' : ''}`}
            />
            <span className="hud-voice-name">{selfName}</span>
            <span className="hud-voice-state">{selfState}</span>
            <span className="hud-players-self">自分</span>
          </div>
          {sorted.map((player) => (
            <div key={player.id} className="hud-voice-row">
              <span
                className={`hud-voice-dot ${speakingIds.includes(player.id) ? 'speaking' : ''}`}
              />
              <span className="hud-voice-name">{player.name || player.id}</span>
              <span className="hud-voice-state">
                {voicePeers[player.id] === 'muted'
                  ? '🔇'
                  : voicePeers[player.id]
                    ? modeIcon(voicePeerModes[player.id])
                    : ''}
              </span>
              <input
                type="range"
                className="hud-voice-slider"
                title="この人の音量"
                min={0}
                max={1}
                step={0.05}
                value={playerVolumes[player.id] ?? 1}
                onChange={(e) => setPlayerVolume(player.id, Number(e.target.value))}
              />
            </div>
          ))}
          {players.length === 0 && (
            <div className="hud-players-empty">ほかのプレイヤーはいません</div>
          )}
        </div>
      </div>
    </FloatingWindow>
  )
}
