import type { Contact, RecentEntry, SourceKind, UsageIndex } from '@engine/types'
import { UsageAggregator } from '@engine/recency'
import { makeDemoData } from '@engine/demo'
import { readEncrypted, writeEncrypted } from './vault'

// Everything imported so far, per source. Cached (encrypted) so the app can
// be reopened without re-importing.

export interface SourceMeta {
  account?: string
  contacts?: number
  usageKeys?: number
  importedAt?: number
  error?: string
}

interface SessionData {
  demo: boolean
  contacts: Partial<Record<SourceKind, Contact[]>>
  usage: Partial<Record<SourceKind, UsageIndex>>
  meta: Partial<Record<SourceKind, SourceMeta>>
  recents?: RecentEntry[]
}

const CACHE = 'session.bin'
let data: SessionData = readEncrypted<SessionData>(CACHE, { demo: false, contacts: {}, usage: {}, meta: {} })

export const session = {
  get: () => data,
  save() {
    writeEncrypted(CACHE, data)
  },
  setSource(kind: SourceKind, contacts: Contact[] | undefined, usage: UsageIndex | undefined, meta: SourceMeta) {
    if (data.demo) data = { demo: false, contacts: {}, usage: {}, meta: {} }
    if (contacts) data.contacts[kind] = contacts
    if (usage) data.usage[kind] = usage
    data.meta[kind] = { ...data.meta[kind], ...meta }
    this.save()
  },
  setMeta(kind: SourceKind, meta: SourceMeta) {
    data.meta[kind] = { ...data.meta[kind], ...meta }
    this.save()
  },
  removeSource(kind: SourceKind) {
    delete data.contacts[kind]
    delete data.usage[kind]
    delete data.meta[kind]
    this.save()
  },
  setRecents(r: RecentEntry[] | undefined) {
    data.recents = r
    this.save()
  },
  loadDemo() {
    const demo = makeDemoData()
    data = { demo: true, contacts: {}, usage: { macmail: demo.usage }, meta: {}, recents: demo.recents }
    for (const c of demo.contacts) (data.contacts[c.source] ??= []).push(c)
    for (const [k, list] of Object.entries(data.contacts)) data.meta[k as SourceKind] = { account: 'Demo data', contacts: list!.length, importedAt: Date.now() }
    for (const k of ['macmail', 'messages', 'calls'] as SourceKind[]) data.meta[k] = { account: 'Demo data', importedAt: Date.now(), usageKeys: Object.keys(demo.usage).length }
    this.save()
  },
  reset() {
    data = { demo: false, contacts: {}, usage: {}, meta: {} }
    this.save()
  },
  allContacts(): Contact[] {
    return Object.values(data.contacts).flat() as Contact[]
  },
  mergedUsage(): UsageIndex {
    const agg = new UsageAggregator()
    for (const u of Object.values(data.usage)) if (u) agg.merge(u)
    return agg.index
  }
}
