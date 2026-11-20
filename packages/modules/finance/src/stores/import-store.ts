"use client"

import { create } from "zustand"

interface ImportProgress {
  label: string
  done: number
  total: number
}

interface ImportState {
  active: ImportProgress | null
  setActive: (progress: ImportProgress | null) => void
  update: (done: number) => void
}

export const useImportStore = create<ImportState>()((set) => ({
  active: null,
  setActive: (active) => set({ active }),
  update: (done) =>
    set((state) =>
      state.active ? { active: { ...state.active, done } } : {}
    ),
}))
