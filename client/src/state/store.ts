import { create } from 'zustand'

interface AppState {
  avatarName: string | null
  status: string
  setAvatarName: (name: string | null) => void
  setStatus: (status: string) => void
}

export const useAppStore = create<AppState>((set) => ({
  avatarName: null,
  status: '',
  setAvatarName: (avatarName) => set({ avatarName }),
  setStatus: (status) => set({ status }),
}))
