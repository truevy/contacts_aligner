import { motion } from 'framer-motion'
import { useMemo, useState } from 'react'
import { Check, GitMerge, Split, Users } from 'lucide-react'
import type { Cluster, Contact, FieldName } from '@engine/types'
import { formatPhone, normalizeEmail, normalizePhone } from '@engine/normalize'
import { isMerged, splitId } from '@engine/align'
import { useStore } from '../lib/store'
import { Card, Empty, Pill, SourceChip } from './ui'

const FIELD_LABEL: Record<FieldName, string> = { displayName: 'Name', organization: 'Company', title: 'Title', birthday: 'Birthday', notes: 'Notes' }
const PAGE = 40

export function matchesQuery(members: Contact[], q: string): boolean {
  if (!q) return true
  const s = q.toLowerCase()
  const digits = s.replace(/\D/g, '')
  return members.some(
    (m) =>
      m.displayName.toLowerCase().includes(s) ||
      m.organization?.toLowerCase().includes(s) ||
      m.emails.some((e) => e.value.toLowerCase().includes(s)) ||
      (digits.length >= 3 && m.phones.some((p) => p.value.replace(/\D/g, '').includes(digits)))
  )
}

export function DuplicatesTab({ query }: { query: string }) {
  const { analysis, byUid } = useStore()
  const [filter, setFilter] = useState<'all' | 'review' | 'auto'>('all')
  const [limit, setLimit] = useState(PAGE)

  const list = useMemo(() => {
    const dups = analysis!.clusters.filter((c) => c.memberUids.length > 1)
    return dups
      .filter((c) => filter === 'all' || c.confidence === filter)
      .filter((c) => matchesQuery(c.memberUids.map((u) => byUid.get(u)!).filter(Boolean), query))
      // Review first, then the biggest groups
      .sort((a, b) => (a.confidence === 'review' ? 0 : 1) - (b.confidence === 'review' ? 0 : 1) || b.memberUids.length - a.memberUids.length)
  }, [analysis, filter, query, byUid])

  const counts = useMemo(() => {
    const dups = analysis!.clusters.filter((c) => c.memberUids.length > 1)
    return { all: dups.length, review: dups.filter((c) => c.confidence === 'review').length, auto: dups.filter((c) => c.confidence === 'auto').length }
  }, [analysis])

  return (
    <div>
      <div className="mb-4 flex gap-2">
        {(['all', 'review', 'auto'] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={`rounded-full px-3 py-1 text-xs font-semibold transition ${filter === f ? 'bg-indigo-500/25 text-indigo-200 ring-1 ring-indigo-400/40' : 'bg-white/5 text-ink-400 hover:text-ink-200'}`}>
            {f === 'all' ? 'All groups' : f === 'review' ? 'Needs review' : 'Confident matches'} · {counts[f]}
          </button>
        ))}
      </div>
      {!list.length && <Empty icon={<Users size={32} />} title="No duplicates here">Nothing matches this filter.</Empty>}
      <div className="space-y-4">
        {list.slice(0, limit).map((c, i) => (
          <ClusterCard key={c.id} cluster={c} index={i} />
        ))}
      </div>
      {limit < list.length && (
        <div className="mt-6 text-center">
          <button className="btn btn-ghost" onClick={() => setLimit((l) => l + PAGE)}>Show more ({list.length - limit} left)</button>
        </div>
      )}
    </div>
  )
}

function ClusterCard({ cluster, index }: { cluster: Cluster; index: number }) {
  const { byUid, decisions, setField, setMerge, analysis } = useStore()
  const members = cluster.memberUids.map((u) => byUid.get(u)!).filter(Boolean)
  const merged = isMerged(cluster, decisions)
  const rejected = !merged
  const chosen = decisions.fields[cluster.id] ?? {}
  // When kept separate, each card is cleaned up on its own history.
  const keptFor = (m: Contact) => {
    const id = merged ? cluster.id : splitId(cluster.id, m.uid)
    const p = analysis!.proposals[id]
    return {
      emails: new Set(p.emails.filter((e) => decisions.emails[id]?.[e.key] ?? e.keep).map((e) => normalizeEmail(e.value))),
      phones: new Set(p.phones.filter((e) => decisions.phones[id]?.[e.key] ?? e.keep).map((e) => e.key))
    }
  }
  const name = chosen.displayName ?? cluster.diffs.find((d) => d.field === 'displayName')?.suggested ?? members[0]?.displayName

  const rows: Array<{ label: string; field?: FieldName; render: (m: Contact) => React.ReactNode }> = [
    ...(['displayName', 'organization', 'title', 'birthday'] as FieldName[]).map((field) => ({
      label: FIELD_LABEL[field],
      field,
      render: (m: Contact) => m[field] || <span className="text-ink-600">—</span>
    })),
    {
      label: 'Emails',
      render: (m: Contact) =>
        m.emails.length ? (
          <div className="space-y-0.5">
            {m.emails.map((e) => (
              <div key={e.value} className={`truncate ${keptFor(m).emails.has(normalizeEmail(e.value)) ? '' : 'text-red-300/70 line-through'}`}>{e.value}</div>
            ))}
          </div>
        ) : <span className="text-ink-600">—</span>
    },
    {
      label: 'Phones',
      render: (m: Contact) =>
        m.phones.length ? (
          <div className="space-y-0.5">
            {m.phones.map((p) => (
              <div key={p.value} className={keptFor(m).phones.has(normalizePhone(p.value)) ? '' : 'text-red-300/70 line-through'}>{formatPhone(normalizePhone(p.value))}</div>
            ))}
          </div>
        ) : <span className="text-ink-600">—</span>
    }
  ]

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index, 10) * 0.03 }}>
      <Card className={`overflow-hidden transition ${rejected ? 'opacity-60' : ''}`}>
        <div className="flex items-center gap-3 border-b border-white/5 px-5 py-3">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-indigo-500/40 to-fuchsia-500/40 text-sm font-bold text-white">
            {name?.slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate font-semibold text-white">{name}</span>
              {cluster.confidence === 'review' ? <Pill color="#fbbf24">Review</Pill> : <Pill color="#34d399">Confident · {Math.round(cluster.score * 100)}%</Pill>}
              {merged ? <Pill color="#818cf8">Will merge</Pill> : <Pill color="#94a3b8">Kept separate</Pill>}
            </div>
            <div className="truncate text-xs text-ink-400">{cluster.reasons.join(' · ')}</div>
          </div>
          <div className="flex gap-1">{[...new Set(members.map((m) => m.source))].map((s) => <SourceChip key={s} kind={s} />)}</div>
          <button className={`btn py-1.5 text-xs ${rejected ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setMerge(cluster.id, !merged)}>
            {rejected ? <><GitMerge size={14} /> Same person, merge</> : <><Split size={14} /> Not the same person</>}
          </button>
        </div>
        <div className="scroll-thin overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left">
                <th className="w-28 px-5 py-2 text-[11px] font-semibold uppercase tracking-wider text-ink-400" />
                {members.map((m) => (
                  <th key={m.uid} className="min-w-44 px-3 py-2"><SourceChip kind={m.source} /></th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const diff = r.field ? cluster.diffs.find((d) => d.field === r.field) : undefined
                const winner = r.field ? chosen[r.field] ?? diff?.suggested : undefined
                return (
                  <tr key={r.label} className="border-t border-white/[.04] align-top">
                    <td className="px-5 py-2 text-xs font-semibold text-ink-400">
                      {r.label}
                      {diff && <div className="mt-0.5 text-[10px] font-medium text-amber-300/80">differs</div>}
                    </td>
                    {members.map((m) => {
                      const v = r.field ? m[r.field] : undefined
                      const isWinner = !!diff && !!v && v === winner
                      return (
                        <td key={m.uid} className="px-3 py-2">
                          {diff && v ? (
                            <button
                              disabled={rejected}
                              onClick={() => setField(cluster.id, r.field!, v)}
                              className={`selectable flex w-full items-center gap-1.5 rounded-lg px-2 py-1 text-left transition ${isWinner ? 'bg-emerald-400/15 text-emerald-100 ring-1 ring-emerald-400/40' : 'text-ink-300 hover:bg-white/5'}`}
                            >
                              {isWinner && <Check size={13} className="shrink-0 text-emerald-300" />}
                              <span className="truncate">{v}</span>
                            </button>
                          ) : (
                            <div className="selectable px-2 py-1 text-ink-200">{r.render(m)}</div>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </motion.div>
  )
}
