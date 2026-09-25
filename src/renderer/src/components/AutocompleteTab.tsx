import { AnimatePresence, motion } from 'framer-motion'
import { useMemo, useState } from 'react'
import { ArrowRight, Info, Mail, Search } from 'lucide-react'
import { emailMatchKey, foldName, normalizeEmail } from '@engine/normalize'
import { buildEmailMatchIndex, combineStats, lastUsed, relativeTime } from '@engine/recency'
import { useStore } from '../lib/store'
import { useAligned, useRecentsPlan } from '../lib/derived'
import { Card, Toggle, recencyColor } from './ui'

interface Entry {
  name: string
  email: string
  lastUsed?: number
  origin: 'contact' | 'recent'
}

function matches(e: Entry, q: string): boolean {
  const s = foldName(q)
  if (!s) return false
  const tokens = foldName(e.name).split(' ')
  return tokens.some((t) => t.startsWith(s)) || foldName(e.name).startsWith(s) || e.email.startsWith(q.toLowerCase())
}

function dedupe(list: Entry[]): Entry[] {
  const seen = new Map<string, Entry>()
  for (const e of list) {
    const k = normalizeEmail(e.email)
    const prev = seen.get(k)
    if (!prev || (e.origin === 'contact' && prev.origin === 'recent')) seen.set(k, e)
  }
  return [...seen.values()].sort((a, b) => (b.lastUsed ?? 0) - (a.lastUsed ?? 0) || a.name.localeCompare(b.name))
}

export function AutocompleteTab() {
  const { data, cleanRecents, set } = useStore()
  const aligned = useAligned()
  const recents = useRecentsPlan()
  const [q, setQ] = useState('Matt')
  const now = Date.now()

  const idx = useMemo(() => buildEmailMatchIndex(data!.usage), [data])
  const lu = (email: string) => lastUsed(combineStats(email, 'email', idx.get(emailMatchKey(email)) ?? []))

  const before = useMemo(() => {
    const list: Entry[] = []
    for (const c of data!.contacts) for (const e of c.emails) list.push({ name: c.displayName, email: normalizeEmail(e.value), origin: 'contact', lastUsed: lu(e.value) })
    for (const r of data!.recents) list.push({ name: r.displayName ?? '', email: normalizeEmail(r.address), origin: 'recent', lastUsed: lu(r.address) ?? r.lastDate })
    return dedupe(list.filter((e) => matches(e, q)))
  }, [data, q, idx])

  const after = useMemo(() => {
    const list: Entry[] = []
    for (const a of aligned) for (const e of a.emails) list.push({ name: a.displayName, email: normalizeEmail(e.value), origin: 'contact', lastUsed: lu(e.value) })
    const keptContactEmails = new Set(list.map((e) => emailMatchKey(e.email)))
    const allContactEmails = new Set(data!.contacts.flatMap((c) => c.emails.map((e) => emailMatchKey(e.value))))
    for (const r of data!.recents) {
      const k = emailMatchKey(r.address)
      if (recents.removedAddresses.has(k)) continue
      // Retired contact addresses also vanish from recents when cleanup is on
      if (cleanRecents && allContactEmails.has(k) && !keptContactEmails.has(k)) continue
      list.push({ name: r.displayName ?? '', email: normalizeEmail(r.address), origin: 'recent', lastUsed: lu(r.address) ?? r.lastDate })
    }
    return dedupe(list.filter((e) => matches(e, q)))
  }, [aligned, data, q, idx, recents, cleanRecents])

  const afterKeys = new Set(after.map((e) => e.email))

  return (
    <div>
      <Card className="mb-5 flex items-center gap-4 p-5">
        <div className="grid h-12 w-12 place-items-center rounded-2xl bg-sky-500/20 text-sky-300"><Mail /></div>
        <div className="flex-1">
          <div className="font-semibold text-white">What Mail suggests when you start typing a name</div>
          <div className="text-sm text-ink-400">Mail autocompletes from Contacts and from its Previous Recipients list. Type a name to compare before and after alignment.</div>
        </div>
        <div className="relative w-64">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
          <input className="field pl-9 text-base" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type a name…" autoFocus />
        </div>
      </Card>

      <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-4">
        <Column title="Before" subtitle={`${before.length} suggestions`} tone="#f87171">
          <AnimatePresence initial={false}>
            {before.map((e) => (
              <Row key={e.email} e={e} now={now} dim={!afterKeys.has(e.email)} />
            ))}
          </AnimatePresence>
        </Column>
        <div className="grid h-40 place-items-center">
          <motion.div animate={{ x: [0, 6, 0] }} transition={{ repeat: Infinity, duration: 1.6 }} className="grid h-12 w-12 place-items-center rounded-full bg-gradient-to-br from-indigo-500 to-fuchsia-500 shadow-lg shadow-fuchsia-500/30">
            <ArrowRight className="text-white" />
          </motion.div>
          <div className="text-center text-xs text-ink-400">−{Math.max(0, before.length - after.length)}</div>
        </div>
        <Column title="After" subtitle={`${after.length} suggestions`} tone="#34d399">
          <AnimatePresence initial={false}>
            {after.map((e) => (
              <Row key={e.email} e={e} now={now} />
            ))}
          </AnimatePresence>
        </Column>
      </div>

      <RecentsPanel cleanRecents={cleanRecents} setClean={(v) => set({ cleanRecents: v })} />
    </div>
  )
}

function Column({ title, subtitle, tone, children }: { title: string; subtitle: string; tone: string; children: React.ReactNode }) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
        <span className="font-semibold" style={{ color: tone }}>{title}</span>
        <span className="text-xs text-ink-400">{subtitle}</span>
      </div>
      <div className="scroll-thin max-h-[520px] overflow-y-auto p-2">{children}</div>
    </Card>
  )
}

function Row({ e, now, dim }: { e: Entry; now: number; dim?: boolean }) {
  const c = recencyColor(e.lastUsed, now)
  return (
    <motion.div layout initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className={`flex items-center gap-3 rounded-lg px-3 py-2 ${dim ? 'opacity-45' : ''}`}>
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: c, boxShadow: `0 0 8px ${c}` }} />
      <div className="min-w-0 flex-1">
        <div className={`truncate text-sm text-white ${dim ? 'line-through decoration-red-400/70' : ''}`}>
          {e.name || <span className="text-ink-400">(no name)</span>} <span className="text-ink-400">&lt;{e.email}&gt;</span>
        </div>
      </div>
      <span className="shrink-0 text-[11px]" style={{ color: c }}>{relativeTime(e.lastUsed, now)}</span>
      {e.origin === 'recent' && <span className="shrink-0 rounded bg-white/5 px-1.5 text-[10px] text-ink-400">recent</span>}
    </motion.div>
  )
}

function RecentsPanel({ cleanRecents, setClean }: { cleanRecents: boolean; setClean: (v: boolean) => void }) {
  const { data, setRecentOverride } = useStore()
  const plan = useRecentsPlan()
  const [showAll, setShowAll] = useState(false)
  if (!data?.recents.length) {
    return (
      <Card className="mt-5 flex items-center gap-3 p-4 text-sm text-ink-400">
        <Info size={16} /> Previous Recipients wasn’t loaded. Connect Mail.app history with Full Disk Access to include it.
      </Card>
    )
  }
  const list = showAll ? plan.suggestions : plan.suggestions.slice(0, 30)
  return (
    <Card className="mt-5 p-5">
      <div className="mb-3 flex items-center gap-3">
        <div className="flex-1">
          <div className="font-semibold text-white">Clean Mail’s Previous Recipients</div>
          <div className="text-xs text-ink-400">
            {plan.rowIds.length} of {data.recents.length.toLocaleString()} entries selected for removal. Mail will be quit briefly and the list is backed up first.
          </div>
        </div>
        <Toggle on={cleanRecents} onChange={setClean} />
      </div>
      {cleanRecents && (
        <div className="grid grid-cols-2 gap-1.5">
          {list.map((s) => {
            const removed = plan.isRemoved(s)
            return (
              <button key={s.entry.rowId} onClick={() => setRecentOverride(s.entry.address, !removed)} className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-left text-sm transition ${removed ? 'bg-red-500/10 text-red-200' : 'bg-white/[.03] text-ink-300'}`}>
                <span className={`grid h-4 w-4 place-items-center rounded border text-[10px] ${removed ? 'border-red-400 bg-red-400 text-white' : 'border-white/20'}`}>{removed && '✕'}</span>
                <span className="min-w-0 flex-1 truncate">{s.entry.displayName} &lt;{s.entry.address}&gt;</span>
                <span className="shrink-0 text-[10px] text-ink-400">{s.reason === 'removed-from-contact' ? 'retired address' : `unknown · ${relativeTime(s.entry.lastDate)}`}</span>
              </button>
            )
          })}
        </div>
      )}
      {cleanRecents && plan.suggestions.length > 30 && (
        <button className="btn btn-ghost mt-3 text-xs" onClick={() => setShowAll((v) => !v)}>{showAll ? 'Show fewer' : `Show all ${plan.suggestions.length}`}</button>
      )}
    </Card>
  )
}
