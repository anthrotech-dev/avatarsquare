import { useAppStore } from '../../state/store'

/** ワールド読込・切替中の全画面オーバーレイ。worldLoadingがnullなら出ない */
export function LoadingOverlay() {
  const worldLoading = useAppStore((s) => s.worldLoading)
  if (worldLoading === null) return null
  return (
    <div className="loading-overlay">
      <div className="loading-overlay-box">
        <div className="loading-overlay-spinner" />
        <div>{worldLoading}</div>
      </div>
    </div>
  )
}
