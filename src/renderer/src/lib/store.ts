import { create } from 'zustand'
import type { AnalysisResult, Contact, Decisions, FieldName, SourceKind } from '@engine/types'
import { emptyDecisions } from '@engine/align'
import { setDefaultRegion } from '@engine/normalize'
import { api, type AppInfo, type Dataset } from './api'

export type Step = 'welcome' | 'sources' | 'summary' | 'preview' | 'destination' | 'review'

interface State {
  step: Step
  info?: AppInfo
  data?: Dataset
  byUid: Map<string, Contact>
  analysis?: AnalysisResult
  analyzing: boolean
  staleYears: number
  historyYears: number
  decisions: Decisions
  targets: SourceKind[]
  createMissing: boolean
  deleteDuplicates: boolean
  cleanRecents: boolean
  go(step: Step): void
  refreshInfo(): Promise<void>
  loadData(): Promise<void>
  runAnalysis(): Promise<void>
  setStaleYears(y: number): void
  setHistoryYears(y: number): void
  setField(clusterId: string, field: FieldName, value: string): void
  setEmailKeep(clusterId: string, key: string, keep: boolean): void
  setPhoneKeep(clusterId: string, key: string, keep: boolean): void
  setMerge(clusterId: string, merge: boolean): void
  /** Previous Recipients: explicit user choice per address, overriding the suggestion default */
  recentsOverride: Record<string, boolean>
  setRecentOverride(address: string, remove: boolean): void
  set(partial: Partial<State>): void
}

let worker: Worker | undefined
function runWorker(msg: unknown): Promise<AnalysisResult> {
  worker ??= new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' })
  return new Promise((resolve, reject) => {
    worker!.onmessage = (e) => resolve(e.data as AnalysisResult)
    worker!.onerror = (e) => reject(new Error(e.message))
    worker!.postMessage(msg)
  })
}

let reproposeTimer: ReturnType<typeof setTimeout> | undefined

export const useStore = create<State>((set, get) => ({
  step: 'welcome',
  byUid: new Map(),
  analyzing: false,
  staleYears: 3,
  historyYears: 10,
  decisions: emptyDecisions(),
  targets: [],
  createMissing: false,
  deleteDuplicates: true,
  cleanRecents: true,
  go: (step) => set({ step }),
  set: (partial) => set(partial),
  async refreshInfo() {
    const info = await api.info()
    setDefaultRegion(info.region)
    set({ info })
  },
  async loadData() {
    const data = await api.data()
    set({ data, byUid: new Map(data.contacts.map((c) => [c.uid, c])), analysis: undefined, decisions: emptyDecisions() })
  },
  async runAnalysis() {
    const { data, staleYears, info } = get()
    if (!data) return
    set({ analyzing: true })
    try {
      const analysis = await runWorker({ type: 'analyze', contacts: data.contacts, usage: data.usage, staleYears, region: info?.region ?? 'US' })
      set({ analysis, decisions: emptyDecisions() })
    } finally {
      set({ analyzing: false })
    }
  },
  setStaleYears(staleYears) {
    set({ staleYears })
    clearTimeout(reproposeTimer)
    reproposeTimer = setTimeout(async () => {
      const { data, analysis, info } = get()
      if (!data || !analysis) return
      const next = await runWorker({ type: 'repropose', clusters: analysis.clusters, contacts: data.contacts, usage: data.usage, staleYears, region: info?.region ?? 'US' })
      set((s) => ({ analysis: next, decisions: { ...s.decisions, emails: {}, phones: {} } }))
    }, 250)
  },
  setHistoryYears: (historyYears) => set({ historyYears }),
  setField: (clusterId, field, value) =>
    set((s) => ({ decisions: { ...s.decisions, fields: { ...s.decisions.fields, [clusterId]: { ...s.decisions.fields[clusterId], [field]: value } } } })),
  setEmailKeep: (clusterId, key, keep) =>
    set((s) => ({ decisions: { ...s.decisions, emails: { ...s.decisions.emails, [clusterId]: { ...s.decisions.emails[clusterId], [key]: keep } } } })),
  setPhoneKeep: (clusterId, key, keep) =>
    set((s) => ({ decisions: { ...s.decisions, phones: { ...s.decisions.phones, [clusterId]: { ...s.decisions.phones[clusterId], [key]: keep } } } })),
  setMerge: (clusterId, merge) => set((s) => ({ decisions: { ...s.decisions, merge: { ...s.decisions.merge, [clusterId]: merge } } })),
  recentsOverride: {},
  setRecentOverride: (address, remove) => set((s) => ({ recentsOverride: { ...s.recentsOverride, [address]: remove } }))
}))
