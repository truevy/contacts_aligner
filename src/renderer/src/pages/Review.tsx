import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useMemo, useState } from 'react'
import { Check, ChevronRight, FolderOpen, LoaderCircle, RefreshCw, ShieldCheck, TriangleAlert, Undo2, Upload } from 'lucide-react'
import type { ChangePlan, PlanOp } from '@engine/types'
import { buildPlans } from '@engine/align'
import { formatPhone, normalizeEmail, normalizePhone } from '@engine/normalize'
import { useStore } from '../lib/store'
import { useAligned, useRecentsPlan } from '../lib/derived'
import { api, type Journal, type JournalSummary } from '../lib/api'
import { SOURCE_BY_KIND } from '../lib/sources'
import { AnimatedNumber, Card, SourceIcon } from '../components/ui'

const OP_COLOR = { update: '#60a5fa', create: '#34d399', delete: '#f87171' }

export function Review() {
  const { data, targets, createMissing, deleteDuplicates, cleanRecents, go, loadData, refreshInfo } = useStore()
  const aligned = useAligned()
  const recents = useRecentsPlan()
  const plans = useMemo(() => (data ? buildPlans(data.contacts, aligned, targets, { createMissing, deleteDuplicates }) : []), [data, aligned, targets, createMissing, deleteDuplicates])
  const recentsIds = cleanRecents ? recents.rowIds : []
  const totalOps = plans.reduce((n, p) => n + p.ops.length, 0)

  const [confirmed, setConfirmed] = useState(false)
  const [phase, setPhase] = useState<'review' | 'pushing' | 'done'>('review')
  const [progress, setProgress] = useState<Record<string, string>>({})
  const [journal, setJournal] = useState<Journal>()
  const [error, setError] = useState<string>()
  const [history, setHistory] = useState<JournalSummary[]>([])

  useEffect(() => api.onProgress((p) => setProgress((s) => ({ ...s, [p.source]: p.message }))), [])
  useEffect(() => {
    api.journals().then(setHistory).catch(() => undefined)
  }, [phase])

  const push = async () => {
    setPhase('pushing')
    setError(undefined)
    try {
      setJournal(await api.push(plans.filter((p) => p.ops.length), recentsIds))
      setPhase('done')
    } catch (err) {
      setError((err as Error).message)
      setPhase('review')
    }
  }

  const undo = async (id: string) => {
    setPhase('pushing')
    setProgress({})
    try {
      const j = await api.undo(id)
      if (journal?.id === id) setJournal(j)
      setHistory(await api.journals())
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setPhase(journal ? 'done' : 'review')
    }
  }

  const startOver = async () => {
    await refreshInfo()
    await loadData()
    go(data?.demo ? 'summary' : 'sources')
  }

  if (phase === 'pushing') return <Pushing progress={progress} />
  if (phase === 'done' && journal) return <Done journal={journal} onUndo={() => undo(journal.id)} onStartOver={startOver} />

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <h2 className="font-display text-3xl font-bold text-white">Review before pushing</h2>
      <p className="mt-1 text-ink-400">This is exactly what will change. Nothing has been sent yet.</p>

      <div className="mt-6 grid grid-cols-3 gap-4">
        {plans.map((p) => <PlanSummary key={p.source} plan={p} />)}
        {recentsIds.length > 0 && (
          <Card className="p-5">
            <div className="font-semibold text-white">Mail Previous Recipients</div>
            <div className="mt-2 text-3xl font-bold text-red-300"><AnimatedNumber value={recentsIds.length} /></div>
            <div className="text-xs text-ink-400">entries removed (Mail is quit briefly)</div>
          </Card>
        )}
      </div>

      <div className="mt-6 space-y-4">
        {plans.filter((p) => p.ops.length).map((p) => <PlanDetail key={p.source} plan={p} />)}
      </div>

      {error && <div className="mt-4 flex gap-2 rounded-xl bg-red-500/10 p-3 text-sm text-red-200"><TriangleAlert size={16} className="mt-0.5" /> {error}</div>}

      <Card className="sticky bottom-4 mt-8 flex items-center gap-4 p-5">
        <ShieldCheck className="shrink-0 text-emerald-300" />
        <label className="flex flex-1 cursor-pointer items-start gap-3 text-sm text-ink-200">
          <input type="checkbox" className="mt-1 accent-emerald-400" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          <span>
            I’ve reviewed these {totalOps.toLocaleString()} changes{recentsIds.length ? ` and ${recentsIds.length} Previous Recipients removals` : ''}.
            A full backup of each account is saved first, and you can undo this push afterwards.
            {data?.demo && <span className="text-fuchsia-300"> Demo mode: only demo data changes.</span>}
          </span>
        </label>
        <button className="btn btn-ghost" onClick={() => go('destination')}>Back</button>
        <button className="btn btn-primary px-6" disabled={!confirmed || (!totalOps && !recentsIds.length)} onClick={push}>
          <Upload size={16} /> Push changes
        </button>
      </Card>

      {history.length > 0 && <History items={history} onUndo={undo} />}
    </div>
  )
}

function PlanSummary({ plan }: { plan: ChangePlan }) {
  const meta = SOURCE_BY_KIND[plan.source]
  const counts = { update: 0, create: 0, delete: 0 }
  for (const o of plan.ops) counts[o.op]++
  const total = plan.ops.length || 1
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center gap-3">
        <SourceIcon kind={plan.source} size={32} />
        <div className="font-semibold text-white">{meta.name}</div>
      </div>
      <div className="mb-3 flex h-2 overflow-hidden rounded-full bg-white/5">
        {(['update', 'create', 'delete'] as const).map((k) => (
          <motion.div key={k} style={{ background: OP_COLOR[k] }} initial={{ width: 0 }} animate={{ width: `${(counts[k] / total) * 100}%` }} transition={{ duration: 0.6 }} />
        ))}
      </div>
      <div className="grid grid-cols-3 text-center">
        {(['update', 'create', 'delete'] as const).map((k) => (
          <div key={k}>
            <div className="text-2xl font-bold" style={{ color: OP_COLOR[k] }}><AnimatedNumber value={counts[k]} /></div>
            <div className="text-[11px] uppercase tracking-wide text-ink-400">{k === 'update' ? 'updated' : k === 'create' ? 'added' : 'deleted'}</div>
          </div>
        ))}
      </div>
      {!plan.ops.length && <div className="mt-2 text-center text-xs text-emerald-300">Already aligned. Nothing to change.</div>}
    </Card>
  )
}

function PlanDetail({ plan }: { plan: ChangePlan }) {
  const [open, setOpen] = useState(false)
  const [limit, setLimit] = useState(50)
  return (
    <Card className="overflow-hidden">
      <button className="flex w-full items-center gap-3 px-5 py-3 text-left" onClick={() => setOpen((o) => !o)}>
        <motion.span animate={{ rotate: open ? 90 : 0 }}><ChevronRight size={16} /></motion.span>
        <SourceIcon kind={plan.source} size={24} />
        <span className="font-semibold text-white">{SOURCE_BY_KIND[plan.source].name}: {plan.ops.length} changes</span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
            <div className="space-y-1 border-t border-white/5 p-3">
              {plan.ops.slice(0, limit).map((op, i) => <OpRow key={i} op={op} />)}
              {limit < plan.ops.length && <button className="btn btn-ghost mt-2 text-xs" onClick={() => setLimit((l) => l + 100)}>Show more ({plan.ops.length - limit})</button>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  )
}

function diffList(before: string[], after: string[], fmt: (s: string) => string = (s) => s) {
  const b = new Set(before)
  const a = new Set(after)
  return [...after.filter((x) => !b.has(x)).map((x) => ({ v: fmt(x), t: '+' as const })), ...before.filter((x) => !a.has(x)).map((x) => ({ v: fmt(x), t: '-' as const }))]
}

function OpRow({ op }: { op: PlanOp }) {
  const color = OP_COLOR[op.op]
  const name = op.op === 'delete' ? op.before.displayName : op.after.displayName
  let details: Array<{ v: string; t: '+' | '-' | '~' }> = []
  if (op.op === 'update') {
    if (op.before.displayName !== op.after.displayName) details.push({ v: `${op.before.displayName} → ${op.after.displayName}`, t: '~' })
    if ((op.before.organization ?? '') !== (op.after.organization ?? '')) details.push({ v: `Company: ${op.before.organization ?? '—'} → ${op.after.organization ?? '—'}`, t: '~' })
    details.push(...diffList(op.before.emails.map((e) => normalizeEmail(e.value)), op.after.emails.map((e) => normalizeEmail(e.value))))
    details.push(...diffList(op.before.phones.map((p) => normalizePhone(p.value)), op.after.phones.map((p) => normalizePhone(p.value)), formatPhone))
  } else if (op.op === 'create') {
    details = [...op.after.emails.map((e) => ({ v: e.value, t: '+' as const })), ...op.after.phones.map((p) => ({ v: p.value, t: '+' as const }))]
  } else {
    details = [{ v: 'duplicate card, merged into another', t: '-' }]
  }
  return (
    <div className="flex items-start gap-3 rounded-lg px-3 py-2 hover:bg-white/[.03]">
      <span className="mt-0.5 w-16 shrink-0 rounded px-1.5 py-0.5 text-center text-[10px] font-bold uppercase" style={{ background: `${color}22`, color }}>{op.op}</span>
      <span className="w-48 shrink-0 truncate text-sm font-medium text-white">{name}</span>
      <div className="flex flex-wrap gap-1.5">
        {details.map((d, i) => (
          <span key={i} className={`rounded px-1.5 py-0.5 text-xs ${d.t === '+' ? 'bg-emerald-400/10 text-emerald-200' : d.t === '-' ? 'bg-red-400/10 text-red-200 line-through' : 'bg-sky-400/10 text-sky-200'}`}>{d.v}</span>
        ))}
      </div>
    </div>
  )
}

function Pushing({ progress }: { progress: Record<string, string> }) {
  return (
    <div className="grid h-full place-items-center">
      <div className="w-[480px] text-center">
        <LoaderCircle className="mx-auto mb-6 animate-spin text-indigo-300" size={48} />
        <div className="mb-6 text-2xl font-bold text-white">Backing up and applying changes…</div>
        <div className="space-y-2 text-left">
          {Object.entries(progress).map(([s, m]) => (
            <Card key={s} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              {s in SOURCE_BY_KIND && <SourceIcon kind={s as keyof typeof SOURCE_BY_KIND} size={24} />}
              <span className="text-ink-200">{m}</span>
            </Card>
          ))}
        </div>
      </div>
    </div>
  )
}

function Done({ journal, onUndo, onStartOver }: { journal: Journal; onUndo: () => void; onStartOver: () => void }) {
  const ok = journal.outcomes.reduce((n, o) => n + o.results.filter((r) => r.ok).length, 0)
  const failed = journal.outcomes.flatMap((o) => o.results.filter((r) => !r.ok).map((r) => ({ ...r, source: o.source })))
  const vendorErrors = journal.outcomes.filter((o) => o.error)
  return (
    <div className="mx-auto max-w-3xl px-8 py-12 text-center">
      <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 200 }} className="mx-auto mb-6 grid h-20 w-20 place-items-center rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 shadow-2xl shadow-emerald-500/30">
        <Check size={40} className="text-white" />
      </motion.div>
      <h2 className="font-display text-3xl font-bold text-white">{journal.undone ? 'Push undone' : 'Contacts aligned'}</h2>
      <p className="mt-2 text-ink-300">
        {ok.toLocaleString()} changes applied{journal.recentsRemoved.length ? `, ${journal.recentsRemoved.length} Previous Recipients removed` : ''}.
        {failed.length ? ` ${failed.length} failed.` : ''}
      </p>

      <div className="mt-8 grid grid-cols-2 gap-3 text-left">
        {journal.outcomes.map((o) => (
          <Card key={o.source} className="flex items-center gap-3 p-4">
            <SourceIcon kind={o.source} size={32} />
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-white">{SOURCE_BY_KIND[o.source].name}</div>
              <div className="truncate text-xs text-ink-400">
                {o.error ? <span className="text-red-300">{o.error}</span> : `${o.results.filter((r) => r.ok).length}/${o.results.length} succeeded`}
              </div>
            </div>
          </Card>
        ))}
      </div>

      {(failed.length > 0 || vendorErrors.length > 0) && (
        <Card className="mt-4 max-h-48 overflow-y-auto p-4 text-left text-xs scroll-thin">
          {failed.slice(0, 50).map((f, i) => (
            <div key={i} className="selectable text-red-200">{SOURCE_BY_KIND[f.source].short} · {f.op} {f.recordId ?? ''}: {f.error}</div>
          ))}
        </Card>
      )}

      <div className="mt-8 flex justify-center gap-3">
        <button className="btn btn-ghost" onClick={() => api.revealBackups()}><FolderOpen size={16} /> Show backups</button>
        {!journal.undone && <button className="btn btn-danger" onClick={onUndo}><Undo2 size={16} /> Undo this push</button>}
        <button className="btn btn-primary" onClick={onStartOver}><RefreshCw size={16} /> Re-import &amp; check again</button>
      </div>
    </div>
  )
}

function History({ items, onUndo }: { items: JournalSummary[]; onUndo: (id: string) => void }) {
  return (
    <div className="mt-10">
      <div className="mb-3 text-xs font-semibold uppercase tracking-widest text-ink-400">Previous pushes</div>
      <div className="space-y-2">
        {items.slice(0, 8).map((j) => (
          <Card key={j.id} className="flex items-center gap-3 px-4 py-3 text-sm">
            <span className="flex-1 text-ink-200">
              {new Date(j.at).toLocaleString()} · {j.opCount} changes{j.demo ? ' (demo)' : ''} · {j.outcomes.map((o) => SOURCE_BY_KIND[o.source].short).join(', ')}
            </span>
            {j.undone ? <span className="text-xs text-ink-400">undone</span> : <button className="btn btn-ghost py-1 text-xs" onClick={() => onUndo(j.id)}><Undo2 size={13} /> Undo</button>}
          </Card>
        ))}
      </div>
    </div>
  )
}
