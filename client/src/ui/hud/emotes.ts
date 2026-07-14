/** VRoid公式7種VRMAの配信元(R2) */
export const EMOTE_BASE_URL = 'https://pub-dadc5f12f65640e4af3119ef5747f350.r2.dev'

export function emoteUrl(id: string): string {
  return `${EMOTE_BASE_URL}/${id}.vrma`
}

/** VRoid公式の7種VRMA */
export const EMOTES = [
  { id: 'VRMA_01', label: '全身' },
  { id: 'VRMA_02', label: '挨拶' },
  { id: 'VRMA_03', label: 'ピース' },
  { id: 'VRMA_04', label: '撃つ' },
  { id: 'VRMA_05', label: '回る' },
  { id: 'VRMA_06', label: 'ポーズ' },
  { id: 'VRMA_07', label: '屈伸' },
]
