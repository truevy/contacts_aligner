import { motion } from 'framer-motion'
import { useMemo, useState } from 'react'
import { AtSign, Phone } from 'lucide-react'
import type { ClusterProposal, Contact, ValueProposal, ValueStatus } from '@engine/types'
import { formatPhone } from '@engine/normalize'
import { relativeTime } from '@engine/recency'
import { alignmentUnits } from '@engine/align'
import { useStore } from '../lib/store'
import { Card, Empty, Pill, RecencyBar, SourceChip, Sparkline, Toggle, recencyColor } from './ui'
import { matchesQuery } from './DuplicatesTab'

type Kind = 'emails' | 'phonesCalls' | 'phonesMessages'

const STATUS: Record<ValueStatus, { label: string; color: string }> = {
  primary: { label: 'Most recent', color: '#34d399' },
  active: { label: 'Active', color: '#60a5fa' },
  stale: { label: 'Stale', color: '#f87171' },
  'no-evidence': { label: 'No history', color: '#94a3b8' }
}

const COPY: Record<Kind, { title: string; unit: string; channel: string }> = {
  emails: { title: 'email', unit: 'messages', channel: 'mail' },
  phonesCalls: { title: 'phone', unit: 'calls', channel: 'calls' },
  phonesMessages: { title: 'phone', unit: 'messages', channel: 'iMessage / SMS' }
}

const PAGE = 50

export function ValuesTab({ kind, query }: { kind: Kind; query: string }) {
  const { analysis, byUid, decisions } = useStore()
  const [filter, setFilter] = useState<'suggested' | 'multiple' | 'all'>('suggested')
  const [limit, setLimit] = useState(PAGE)
  const isEmail = kind === 'emails'
  const now = Date.now()

  const rows = useMemo(() => {
    const out: Array<{ id: string; p: ClusterProposal; values: ValueProposal[]; members: Contact[] }> = []
    for (const unit of alignmentUnits(analysis!, decisions)) {
      const p = analysis!.proposals[unit.id]
      const values = p[kind]
      if (!values.length) continue
      const hasSuggestion = values.some((v) => !v.keep) || (values.length > 1 && values.some((v) => v.status === 'primary'))
      if (filter === 'suggested' && !hasSuggestion) continue
      if (filter === 'multiple' && values.length < 2) continue
      const members = unit.memberUids.map((u) => byUid.get(u)!).filter(Boolean)
      if (!matchesQuery(members, query)) continue
      out.push({ id: unit.id, p, values, members })
    }
    // Most cleanup potential first
    return out.sort((a, b) => b.values.filter((v) => !v.keep).length - a.values.filter((v) => !v.keep).length || b.values.length - a.values.length)
  }, [analysis, kind, filter, query, byUid, decisions.merge])

  const noUsage = useMemo(() => !Object.values(analysis!.proposals).some((p) => p[kind].some((v) => v.lastUsed)), [analysis, kind])

  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        {(['suggested', 'multiple', 'all'] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={`rounded-full px-3 py-1 text-xs font-semibold transition ${filter === f ? 'bg-indigo-500/25 text-indigo-200 ring-1 ring-indigo-400/40' : 'bg-white/5 text-ink-400 hover:text-ink-200'}`}>
            {f === 'suggested' ? 'With suggestions' : f === 'multiple' ? `Multiple ${COPY[kind].title}s` : 'Everyone'}
          </button>
        ))}
        <span className="ml-auto text-xs text-ink-400">{rows.length.toLocaleString()} people</span>
        <Legend />
      </div>
      {noUsage && (
        <Card className="mb-4 border-amber-400/30 px-5 py-3 text-sm text-amber-100">
          No {COPY[kind].channel} history was imported, so there’s nothing to rank by yet. Connect {isEmail ? 'Mail.app history or a mail account' : kind === 'phonesCalls' ? 'iPhone call history' : 'Messages'} on the Sources page.
        </Card>
      )}
      {!rows.length && <Empty icon={isEmail ? <AtSign size={32} /> : <Phone size={32} />} title="Nothing to clean up here">Try another filter.</Empty>}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {rows.slice(0, limit).map((r, i) => (
          <PersonValues key={r.id} clusterId={r.id} values={r.values} members={r.members} kind={kind} index={i} now={now} />
        ))}
      </div>
      {limit < rows.length && (
        <div className="mt-6 text-center">
          <button className="btn btn-ghost" onClick={() => setLimit((l) => l + PAGE)}>Show more ({rows.length - limit} left)</button>
        </div>
      )}
    </div>
  )
}

function Legend() {
  return (
    <div className="flex items-center gap-2 text-[11px] text-ink-400">
      {[['<3 mo', '#34d399'], ['<1 yr', '#a3e635'], ['<2 yr', '#fbbf24'], ['<4 yr', '#fb923c'], ['older', '#f87171']].map(([l, c]) => (
        <span key={l} className="flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: c }} />{l}</span>
      ))}
    </div>
  )
}

function PersonValues({ clusterId, values, members, kind, index, now }: { clusterId: string; values: ValueProposal[]; members: Contact[]; kind: Kind; index: number; now: number }) {
  const { decisions, setEmailKeep, setPhoneKeep, analysis } = useStore()
  const isEmail = kind === 'emails'
  const overrides = isEmail ? decisions.emails[clusterId] : decisions.phones[clusterId]
  // Phone keep/remove is shared between the Calls and Messages tabs; its default comes from calls + messages combined.
  const combined = isEmail ? undefined : analysis!.proposals[clusterId].phones
  const keepOf = (v: ValueProposal) => overrides?.[v.key] ?? (combined ? combined.find((c) => c.key === v.key)?.keep ?? v.keep : v.keep)
  const name = members[0]?.displayName
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index, 12) * 0.025 }}>
      <Card className="p-4">
        <div className="mb-3 flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold text-white">{name}</div>
            <div className="truncate text-xs text-ink-400">{[...new Set(members.map((m) => m.organization).filter(Boolean))].join(' · ') || `${members.length} card${members.length > 1 ? 's' : ''}`}</div>
          </div>
          <div className="flex gap-1">{[...new Set(members.map((m) => m.source))].map((s) => <SourceChip key={s} kind={s} />)}</div>
        </div>
        <div className="space-y-1.5">
          {values.map((v) => {
            const keep = keepOf(v)
            const st = STATUS[v.status]
            return (
              <div key={v.key} className={`flex items-center gap-3 rounded-xl px-3 py-2 transition ${keep ? 'bg-white/[.03]' : 'bg-red-500/[.06]'}`}>
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: recencyColor(v.lastUsed, now), boxShadow: `0 0 8px ${recencyColor(v.lastUsed, now)}` }} />
                <div className="min-w-0 flex-1">
                  <div className={`selectable truncate text-sm font-medium ${keep ? 'text-white' : 'text-ink-400 line-through'}`}>
                    {isEmail ? v.value : formatPhone(v.key)}
                    {v.label && <span className="ml-1.5 text-[11px] font-normal text-ink-400">{v.label}</span>}
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <RecencyBar lastUsed={v.lastUsed} now={now} width={90} />
                    <span className="text-[11px] text-ink-400">{v.lastUsed ? `last ${relativeTime(v.lastUsed, now)}` : 'never seen'}{v.count12mo ? ` · ${v.count12mo} ${COPY[kind].unit}/yr` : ''}</span>
                  </div>
                </div>
                <Sparkline data={v.spark} color={recencyColor(v.lastUsed, now)} width={96} height={24} />
                <Pill color={st.color} className="w-28 justify-center">{st.label}</Pill>
                <Toggle on={keep} onChange={(k) => (isEmail ? setEmailKeep : setPhoneKeep)(clusterId, v.key, k)} color="#34d399" />
              </div>
            )
          })}
        </div>
      </Card>
    </motion.div>
  )
}
