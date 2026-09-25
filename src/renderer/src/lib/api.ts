import type { Api } from '../../../preload'
import type { Contact, RecentEntry, SourceKind, UsageIndex } from '@engine/types'

declare global {
  interface Window {
    api: Api
  }
}

export interface SourceStatus {
  kind: SourceKind
  configured: boolean
  /** Can be pushed to (read-only sources such as an imported file can't) */
  writable?: boolean
  account?: string
  contacts?: number
  usageKeys?: number
  importedAt?: number
  error?: string
}

export type Access = 'ok' | 'missing' | 'denied'

export interface AppInfo {
  platform: string
  region: string
  demo: boolean
  fda: { mail: Access; messages: Access; calls: Access; recents: Access } | null
  sources: SourceStatus[]
}

export interface Dataset {
  contacts: Contact[]
  usage: UsageIndex
  recents: RecentEntry[]
  demo: boolean
}

export interface IphoneBackup {
  path: string
  deviceName: string
  date?: string
  encrypted: boolean
}

export const api = {
  info: () => window.api.invoke<AppInfo>('app:info'),
  connect: (kind: SourceKind, payload: Record<string, unknown>) => window.api.invoke<string>('source:connect', kind, payload),
  disconnect: (kind: SourceKind) => window.api.invoke<void>('source:disconnect', kind),
  importSource: (kind: SourceKind, years: number) => window.api.invoke<void>('source:import', kind, years),
  loadRecents: () => window.api.invoke<number>('recents:load'),
  data: () => window.api.invoke<Dataset>('data:get'),
  loadDemo: () => window.api.invoke<void>('demo:load'),
  reset: () => window.api.invoke<void>('session:reset'),
  iphoneBackups: () => window.api.invoke<IphoneBackup[]>('iphone:backups'),
  open: (url: string) => window.api.invoke<void>('shell:open', url),
  privacy: (pane: 'fullDisk' | 'contacts' | 'internetAccounts') => window.api.invoke<void>('shell:privacy', pane),
  macAccounts: () => window.api.invoke<MacAccount[]>('apple:containers'),
  pickContactsFile: () => window.api.invoke<string | undefined>('dialog:pickContactsFile'),
  readClientJson: () => window.api.invoke<string | undefined>('dialog:readJson'),
  save: (content: string, name: string) => window.api.invoke<string | undefined>('export:save', content, name),
  push: (plans: unknown, recentsRowIds: number[]) => window.api.invoke<Journal>('push:execute', plans, recentsRowIds),
  undo: (id: string) => window.api.invoke<Journal>('push:undo', id),
  journals: () => window.api.invoke<JournalSummary[]>('push:journals'),
  revealBackups: () => window.api.invoke<void>('push:revealBackups'),
  onProgress: (fn: (p: { source: string; message: string; count?: number }) => void) => window.api.onProgress(fn)
}

export interface ApplyResult {
  op: 'update' | 'create' | 'delete'
  recordId?: string
  ok: boolean
  error?: string
  createdId?: string
}

export interface Journal {
  id: string
  at: number
  demo: boolean
  outcomes: Array<{ source: SourceKind; backupFile?: string; results: ApplyResult[]; error?: string }>
  recentsRemoved: number[]
  undone?: number
}

export type JournalSummary = Omit<Journal, 'plans'> & { opCount: number }

export interface MacAccount {
  id: string
  name: string
  type: 'local' | 'exchange' | 'cardDAV' | 'unassigned'
  count: number
}
