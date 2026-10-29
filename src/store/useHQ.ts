import { create } from 'zustand'
import { world } from '../data/world'
import type { Snapshot } from '../data/types'

export type ViewFilter = 'all' | 'running' | 'error'

interface HQState {
  snap: Snapshot
  focusDept: string | null
  openAgentId: string | null
  roam: boolean
  filter: ViewFilter
  booted: boolean
  setFocusDept: (id: string | null) => void
  openAgent: (id: string | null) => void
  setRoam: (v: boolean) => void
  setFilter: (f: ViewFilter) => void
  setBooted: (v: boolean) => void
}

export const useHQ = create<HQState>((set) => ({
  snap: world.snapshot(),
  focusDept: null,
  openAgentId: null,
  roam: true,
  filter: 'all',
  booted: false,
  setFocusDept: (id) => set({ focusDept: id }),
  openAgent: (id) => set({ openAgentId: id }),
  setRoam: (v) => set({ roam: v }),
  setFilter: (f) => set({ filter: f }),
  setBooted: (v) => set({ booted: v }),
}))

/* 世界 → UI 的节流推送：UI 约 2.5fps 刷新，3D 场景自己每帧读 world */
let last = 0
world.subscribe(() => {
  const t = performance.now()
  if (t - last < 420) return
  last = t
  useHQ.setState({ snap: world.snapshot() })
})
world.start()
