import { useAppStore } from '../../state/store'

/**
 * VC状態のHUD要素(HudElement id='vc')。現在の参加/ミュート/発話中を
 * 一目で示し、ワンクリックでVC・マイクを切り替えられる。
 * 例によって操作はすべてコマンド(/vc /mic /voice)経由。
 */
export function VoicePanel() {
  const dispatch = useAppStore((s) => s.dispatch)
  const voiceEnabled = useAppStore((s) => s.voiceEnabled)
  const micMuted = useAppStore((s) => s.micMuted)
  const selfId = useAppStore((s) => s.selfId)
  const speaking = useAppStore((s) => selfId !== null && s.speakingIds.includes(selfId))

  const label = !voiceEnabled ? 'VC OFF' : micMuted ? 'VC ON(ミュート)' : 'VC ON'
  const stateClass = !voiceEnabled ? 'off' : speaking ? 'speaking' : micMuted ? 'muted' : 'on'

  return (
    <div className={`hud-voice-panel ${stateClass}`}>
      <button
        type="button"
        className="hud-voice-panel-label"
        title="ボイスチャットウィンドウを開く"
        onClick={() => void dispatch?.('/voice')}
      >
        {label}
      </button>
      <button
        type="button"
        title={voiceEnabled ? 'VCから離脱' : 'VCに参加'}
        onClick={() => void dispatch?.('/vc toggle')}
      >
        {voiceEnabled ? '🔌' : '📞'}
      </button>
      <button
        type="button"
        title={micMuted ? 'ミュート解除' : 'ミュート'}
        disabled={!voiceEnabled}
        onClick={() => void dispatch?.('/mic toggle')}
      >
        {micMuted ? '🔇' : '🎤'}
      </button>
    </div>
  )
}
