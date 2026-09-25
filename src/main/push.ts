import { app } from 'electron'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ChangePlan, Contact, PlanOp, SourceKind } from '@engine/types'
import { getConnector } from './connectors'
import { contactToAligned, type ApplyResult, type Ctx } from './connectors/types'
import { removeRecents, restoreRecents } from './connectors/localMac'
import { session } from './session'
import { UsageAggregator } from '@engine/recency'

export interface VendorOutcome {
  source: SourceKind
  backupFile?: string
  results: ApplyResult[]
  error?: string
}

export interface Journal {
  id: string
  at: number
  demo: boolean
  plans: ChangePlan[]
  outcomes: VendorOutcome[]
  recentsRemoved: number[]
  undone?: number
}

const backupsRoot = () => join(app.getPath('userData'), 'backups')

function writeJournal(j: Journal) {
  const dir = join(backupsRoot(), j.id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'journal.json'), JSON.stringify(j, null, 1), { mode: 0o600 })
}

export function listJournals(): Array<Omit<Journal, 'plans'> & { opCount: number }> {
  if (!existsSync(backupsRoot())) return []
  return readdirSync(backupsRoot())
    .map((id) => join(backupsRoot(), id, 'journal.json'))
    .filter(existsSync)
    .map((p) => JSON.parse(readFileSync(p, 'utf8')) as Journal)
    .map(({ plans, ...j }) => ({ ...j, opCount: plans.reduce((n, p) => n + p.ops.length, 0) }))
    .sort((a, b) => b.at - a.at)
}

// ---- Demo mode: apply plans to the in-memory dataset ------------------------

function demoApply(source: SourceKind, ops: PlanOp[]): ApplyResult[] {
  const data = session.get()
  const list = (data.contacts[source] ??= [])
  return ops.map((op): ApplyResult => {
    if (op.op === 'delete') {
      const i = list.findIndex((c) => c.recordId === op.recordId)
      if (i >= 0) list.splice(i, 1)
      return { op: 'delete', recordId: op.recordId, ok: i >= 0 }
    }
    const a = op.after
    const fields = { displayName: a.displayName, firstName: a.firstName, middleName: a.middleName, lastName: a.lastName, organization: a.organization, title: a.title, emails: a.emails, phones: a.phones }
    if (op.op === 'update') {
      const c = list.find((x) => x.recordId === op.recordId)
      if (c) Object.assign(c, fields)
      return { op: 'update', recordId: op.recordId, ok: !!c }
    }
    const id = `demo-new-${Math.random().toString(36).slice(2, 9)}`
    list.push({ uid: `${source}:${id}`, source, recordId: id, addresses: a.addresses, ...fields })
    return { op: 'create', ok: true, createdId: id }
  })
}

// ---- Push ----------------------------------------------------------------------

export async function executePush(plans: ChangePlan[], recentsRowIds: number[], progress: (source: string, message: string) => void): Promise<Journal> {
  const id = new Date().toISOString().replace(/[:.]/g, '-')
  const dir = join(backupsRoot(), id)
  mkdirSync(dir, { recursive: true })
  const demo = session.get().demo
  const journal: Journal = { id, at: Date.now(), demo, plans, outcomes: [], recentsRemoved: [] }

  for (const plan of plans) {
    if (!plan.ops.length) continue
    const outcome: VendorOutcome = { source: plan.source, results: [] }
    journal.outcomes.push(outcome)
    const ctx: Ctx = { progress: (m) => progress(plan.source, m), usage: new UsageAggregator(), since: 0 }
    try {
      if (demo) {
        writeFileSync(join(dir, `${plan.source}.json`), JSON.stringify(session.get().contacts[plan.source] ?? [], null, 1), { mode: 0o600 })
        outcome.results = demoApply(plan.source, plan.ops)
      } else {
        const connector = getConnector(plan.source)
        if (!connector.apply || !connector.backup) throw new Error('This source does not support writing.')
        // No backup, no push.
        progress(plan.source, 'Backing up…')
        const b = await connector.backup()
        outcome.backupFile = join(dir, `${plan.source}.${b.ext}`)
        writeFileSync(outcome.backupFile, b.data, { mode: 0o600 })
        progress(plan.source, `Applying ${plan.ops.length} changes…`)
        outcome.results = await connector.apply(plan.ops, ctx)
      }
    } catch (err) {
      outcome.error = err instanceof Error ? err.message : String(err)
    }
    writeJournal(journal)
  }

  if (recentsRowIds.length) {
    progress('recents', 'Cleaning Previous Recipients…')
    if (demo) {
      const set = new Set(recentsRowIds)
      writeFileSync(join(dir, 'recents.json'), JSON.stringify(session.get().recents ?? []), { mode: 0o600 })
      session.setRecents((session.get().recents ?? []).filter((r) => !set.has(r.rowId)))
    } else await removeRecents(recentsRowIds, join(dir, 'recents'))
    journal.recentsRemoved = recentsRowIds
  }
  if (demo) session.save()
  writeJournal(journal)
  return journal
}

// ---- Undo ----------------------------------------------------------------------

function inverseOps(plan: ChangePlan, results: ApplyResult[]): PlanOp[] {
  const inv: PlanOp[] = []
  plan.ops.forEach((op, i) => {
    const r = results[i]
    if (!r?.ok) return
    if (op.op === 'update') inv.push({ op: 'update', source: op.source, recordId: op.recordId, before: op.before, after: contactToAligned(op.before) })
    else if (op.op === 'delete') inv.push({ op: 'create', source: op.source, after: contactToAligned(op.before), restoreRaw: op.before.raw })
    else if (r.createdId) inv.push({ op: 'delete', source: op.source, recordId: r.createdId, before: { uid: '', source: op.source, recordId: r.createdId, displayName: op.after.displayName, emails: [], phones: [], addresses: [] } as Contact })
  })
  return inv
}

export async function undoPush(id: string, progress: (source: string, message: string) => void): Promise<Journal> {
  const path = join(backupsRoot(), id, 'journal.json')
  const journal = JSON.parse(readFileSync(path, 'utf8')) as Journal
  if (journal.undone) throw new Error('This push was already undone.')
  for (const outcome of journal.outcomes) {
    const plan = journal.plans.find((p) => p.source === outcome.source)!
    const ops = inverseOps(plan, outcome.results)
    if (!ops.length) continue
    progress(outcome.source, `Reverting ${ops.length} changes…`)
    if (journal.demo) {
      if (session.get().demo) demoApply(outcome.source, ops)
    } else {
      const connector = getConnector(outcome.source)
      await connector.apply!(ops, { progress: (m) => progress(outcome.source, m), usage: new UsageAggregator(), since: 0 })
    }
  }
  if (journal.recentsRemoved.length) {
    if (journal.demo) {
      const saved = JSON.parse(readFileSync(join(backupsRoot(), id, 'recents.json'), 'utf8'))
      session.setRecents(saved)
    } else await restoreRecents(join(backupsRoot(), id, 'recents'))
  }
  if (journal.demo) session.save()
  journal.undone = Date.now()
  writeJournal(journal)
  return journal
}
