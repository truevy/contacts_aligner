import { AnimatePresence, motion } from 'framer-motion'
import { useDeferredValue, useMemo, useState } from 'react'
import { ArrowRight, AtSign, GitMerge, MessageCircle, Phone, Search, SlidersHorizontal, Sparkles } from 'lucide-react'
import { alignmentUnits, isMerged } from '@engine/align'
import { useStore } from '../lib/store'
import { AnimatedNumber, Card } from '../components/ui'
import { DuplicatesTab } from '../components/DuplicatesTab'
import { ValuesTab } from '../components/ValuesTab'
import { AutocompleteTab } from '../components/AutocompleteTab'

const TABS = [
  { id: 'dups', label: 'Duplicates', icon: GitMerge },
  { id: 'emails', label: 'Emails', icon: AtSign },
  { id: 'calls', label: 'Phones · Calls', icon: Phone },
  { id: 'messages', label: 'Phones · Messages', icon: MessageCircle },
  { id: 'autocomplete', label: 'Mail Autocomplete', icon: Sparkles }
] as const
type Tab = (typeof TABS)[number]['id']

export function Preview() {
  const { analysis, analyzing, staleYears, setStaleYears, decisions, go, data } = useStore()
  const [tab, setTab] = useState<Tab>('dups')
  const [query, setQuery] = useState('')
  const q = useDeferredValue(query)

  const stats = useMemo(() => {
    if (!analysis) return undefined
    const dups = analysis.clusters.filter((c) => c.memberUids.length > 1)
    const units = alignmentUnits(analysis, decisions)
    let staleEmails = 0
    let stalePhones = 0
    for (const { id } of units) {
      const p = analysis.proposals[id]
      staleEmails += p.emails.filter((e) => !(decisions.emails[id]?.[e.key] ?? e.keep)).length
      stalePhones += p.phones.filter((e) => !(decisions.phones[id]?.[e.key] ?? e.keep)).length
    }
    return {
      people: units.length,
      dups: dups.filter((c) => isMerged(c, decisions)).length,
      review: dups.filter((c) => c.confidence === 'review' && decisions.merge[c.id] === undefined).length,
      staleEmails,
      stalePhones
    }
  }, [analysis, decisions])

  if (analyzing || !analysis) return <Analyzing count={data?.contacts.length ?? 0} />

  return (
    <div className="mx-auto max-w-7xl px-8 py-8">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h2 className="font-display text-3xl font-bold text-white">Alignment preview</h2>
          <p className="mt-1 text-ink-400">Nothing has changed yet. Review what we suggest, adjust anything you like, then choose where the results go.</p>
        </div>
        <button className="btn btn-primary px-5 py-2.5" onClick={() => go('destination')}>
          Choose destination <ArrowRight size={16} />
        </button>
      </div>

      <div className="mb-6 grid grid-cols-6 gap-3">
        <Kpi label="Unique people" value={stats!.people} color="#818cf8" />
        <Kpi label="Groups to merge" value={stats!.dups} color="#c084fc" />
        <Kpi label="Awaiting review" value={stats!.review} color="#fbbf24" />
        <Kpi label="Emails to retire" value={stats!.staleEmails} color="#f87171" />
        <Kpi label="Numbers to retire" value={stats!.stalePhones} color="#fb923c" />
        <Card className="p-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-ink-300"><SlidersHorizontal size={13} /> Stale after</div>
          <div className="mt-1 text-2xl font-bold text-white">{staleYears} yr{staleYears === 1 ? '' : 's'}</div>
          <input type="range" min={1} max={10} step={1} value={staleYears} onChange={(e) => setStaleYears(Number(e.target.value))} className="mt-1 w-full accent-indigo-400" />
        </Card>
      </div>

      <OverlapStrip overlap={analysis.overlap} />

      <div className="sticky top-0 z-10 -mx-2 mb-4 flex items-center gap-2 bg-ink-900/80 px-2 py-3 backdrop-blur-xl">
        <div className="flex rounded-xl bg-white/5 p-1">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} className={`relative flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-sm font-semibold transition ${tab === t.id ? 'text-white' : 'text-ink-400 hover:text-ink-200'}`}>
              {tab === t.id && <motion.div layoutId="tab" className="absolute inset-0 rounded-lg bg-white/10" transition={{ type: 'spring', stiffness: 400, damping: 35 }} />}
              <t.icon size={15} className="relative" />
              <span className="relative">{t.label}</span>
            </button>
          ))}
        </div>
        {tab !== 'autocomplete' && (
          <div className="relative ml-auto w-72">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
            <input className="field pl-9" placeholder="Filter by name, email or number" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
        )}
      </div>

      <AnimatePresence mode="wait">
        <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
          {tab === 'dups' && <DuplicatesTab query={q} />}
          {tab === 'emails' && <ValuesTab kind="emails" query={q} />}
          {tab === 'calls' && <ValuesTab kind="phonesCalls" query={q} />}
          {tab === 'messages' && <ValuesTab kind="phonesMessages" query={q} />}
          {tab === 'autocomplete' && <AutocompleteTab />}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

function Kpi({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <Card className="relative overflow-hidden p-4">
      <div className="absolute -right-8 -top-8 h-24 w-24 rounded-full blur-2xl" style={{ background: `${color}30` }} />
      <div className="text-xs font-semibold text-ink-300">{label}</div>
      <div className="mt-1 text-3xl font-bold" style={{ color }}><AnimatedNumber value={value} /></div>
    </Card>
  )
}

function OverlapStrip({ overlap }: { overlap: Record<number, number> }) {
  const entries = Object.entries(overlap).map(([k, v]) => [Number(k), v] as const).sort((a, b) => a[0] - b[0])
  const total = entries.reduce((n, [, v]) => n + v, 0) || 1
  const colors = ['#475569', '#818cf8', '#c084fc', '#f472b6', '#fb7185', '#fbbf24']
  return (
    <Card className="mb-6 p-4">
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="font-semibold text-ink-300">How many sources each person appears in</span>
        <span className="text-ink-400">{entries.filter(([k]) => k > 1).reduce((n, [, v]) => n + v, 0).toLocaleString()} people are spread across more than one source</span>
      </div>
      <div className="flex h-7 overflow-hidden rounded-lg">
        {entries.map(([k, v], i) => (
          <motion.div
            key={k}
            className="flex items-center justify-center text-[11px] font-bold text-white"
            style={{ background: colors[Math.min(k - 1, colors.length - 1)] }}
            initial={{ width: 0 }}
            animate={{ width: `${(v / total) * 100}%` }}
            transition={{ delay: i * 0.1, duration: 0.6 }}
            title={`${v} people in ${k} source(s)`}
          >
            {v / total > 0.06 && `${k} source${k > 1 ? 's' : ''} · ${v}`}
          </motion.div>
        ))}
      </div>
    </Card>
  )
}

function Analyzing({ count }: { count: number }) {
  const steps = ['Normalizing names, emails and numbers', 'Finding duplicates across sources', 'Checking when each address was last used', 'Ranking calls and messages', 'Drafting cleanup suggestions']
  return (
    <div className="grid h-full place-items-center">
      <div className="text-center">
        <div className="relative mx-auto mb-8 h-40 w-40">
          {[0, 1, 2].map((i) => (
            <motion.div key={i} className="absolute inset-0 rounded-full border-2 border-indigo-400/40" animate={{ scale: [0.4, 1.3], opacity: [0.8, 0] }} transition={{ duration: 2.2, repeat: Infinity, delay: i * 0.7 }} />
          ))}
          <div className="absolute inset-10 grid place-items-center rounded-full bg-gradient-to-br from-indigo-500 to-fuchsia-500 shadow-2xl shadow-indigo-500/40">
            <GitMerge className="text-white" size={32} />
          </div>
        </div>
        <div className="text-2xl font-bold text-white">Comparing {count.toLocaleString()} contact cards…</div>
        <div className="mt-4 space-y-1.5">
          {steps.map((s, i) => (
            <motion.div key={s} className="text-sm text-ink-300" initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 0.5] }} transition={{ delay: i * 0.5, duration: 1.2 }}>
              {s}
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  )
}
