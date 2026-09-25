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
const empty = (): SessionData => ({ demo: false, contacts: {}, usage: {}, meta: {} })
// Loaded on first use, never at import time: Keychain-backed decryption only works after app 'ready'.
let loaded: SessionData | undefined
function d(): SessionData {
  return (loaded ??= readEncrypted<SessionData>(CACHE, empty()))
}

export const session = {
  get: () => d(),
  save() {
    writeEncrypted(CACHE, d())
  },
  setSource(kind: SourceKind, contacts: Contact[] | undefined, usage: UsageIndex | undefined, meta: SourceMeta) {
    if (d().demo) loaded = empty()
    if (contacts) d().contacts[kind] = contacts
    if (usage) d().usage[kind] = usage
    d().meta[kind] = { ...d().meta[kind], ...meta }
    this.save()
  },
  setMeta(kind: SourceKind, meta: SourceMeta) {
    d().meta[kind] = { ...d().meta[kind], ...meta }
    this.save()
  },
  removeSource(kind: SourceKind) {
    delete d().contacts[kind]
    delete d().usage[kind]
    delete d().meta[kind]
    this.save()
  },
  setRecents(r: RecentEntry[] | undefined) {
    d().recents = r
    this.save()
  },
  loadDemo() {
    const demo = makeDemoData()
    loaded = { demo: true, contacts: {}, usage: { macmail: demo.usage }, meta: {}, recents: demo.recents }
    for (const c of demo.contacts) (d().contacts[c.source] ??= []).push(c)
    for (const [k, list] of Object.entries(d().contacts)) d().meta[k as SourceKind] = { account: 'Demo data', contacts: list!.length, importedAt: Date.now() }
    for (const k of ['macmail', 'messages', 'calls'] as SourceKind[]) d().meta[k] = { account: 'Demo data', importedAt: Date.now(), usageKeys: Object.keys(demo.usage).length }
    this.save()
  },
  reset() {
    loaded = empty()
    this.save()
  },
  allContacts(): Contact[] {
    return Object.values(d().contacts).flat() as Contact[]
  },
  mergedUsage(): UsageIndex {
    const agg = new UsageAggregator()
    for (const u of Object.values(d().usage)) if (u) agg.merge(u)
    return agg.index
  }
}
