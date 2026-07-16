import { useAppStore } from '../../state/store'

/**
 * 戦闘不能時の復活確認ダイアログ(全画面オーバーレイ)。
 * 背景はpointer-events:noneで、倒れている間もチャット等のHUD操作は生かす。
 * 復活はコマンド経由(/respawn)なのでホットバーやマクロからも実行できる。
 */
export function ReviveDialog() {
  const dead = useAppStore((s) => s.dead)
  const dispatch = useAppStore((s) => s.dispatch)
  if (!dead) return null
  return (
    <div className="revive-overlay">
      <div className="revive-overlay-box">
        <div className="revive-overlay-title">戦闘不能</div>
        <div>復活しますか？</div>
        <button type="button" onClick={() => void dispatch?.('/respawn')}>
          復活する(スポーン地点に戻る)
        </button>
      </div>
    </div>
  )
}
