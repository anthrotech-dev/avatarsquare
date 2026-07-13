import { create } from 'zustand'

interface AppState {
  avatarName: string | null
  status: string
  netStatus: string
  peers: number
  setAvatarName: (name: string | null) => void
  setStatus: (status: string) => void
  setNetStatus: (netStatus: string) => void
  setPeers: (peers: number) => void
}

export const useAppStore = create<AppState>((set) => ({
  avatarName: null,
  status: '',
  netStatus: 'オフライン',
  peers: 0,
  setAvatarName: (avatarName) => set({ avatarName }),
  setStatus: (status) => set({ status }),
  setNetStatus: (netStatus) => set({ netStatus }),
  setPeers: (peers) => set({ peers }),
}))
