import type {
  AlignedContact,
  AnalysisResult,
  ChangePlan,
  Cluster,
  Contact,
  Decisions,
  LabeledValue,
  PlanOp,
  SourceKind,
  ValueProposal
} from './types'
import { foldName, normalizeEmail, normalizePhone, splitName } from './normalize'
import { fieldDiffs, suggestValue } from './match'

export const emptyDecisions = (): Decisions => ({
  fields: {},
  emails: {},
  phones: {},
  merge: {}
})

export function isMerged(cluster: Cluster, decisions: Decisions): boolean {
  if (cluster.memberUids.length < 2) return false
  return decisions.merge[cluster.id] ?? cluster.confidence === 'auto'
}

/** Id used for one member of a cluster that stays split. Proposals exist under this id too. */
export const splitId = (clusterId: string, uid: string) => `${clusterId}#${uid}`

export interface Unit {
  /** Key into analysis.proposals and decisions */
  id: string
  cluster: Cluster
  memberUids: string[]
}

/** The people that will exist after alignment: merged clusters, or each member of a split one. */
export function alignmentUnits(analysis: AnalysisResult, decisions: Decisions): Unit[] {
  const out: Unit[] = []
  for (const cl of analysis.clusters) {
    if (cl.memberUids.length < 2 || isMerged(cl, decisions)) out.push({ id: cl.id, cluster: cl, memberUids: cl.memberUids })
    else for (const u of cl.memberUids) out.push({ id: splitId(cl.id, u), cluster: cl, memberUids: [u] })
  }
  return out
}

function keepValues(
  proposals: ValueProposal[] | undefined,
  overrides: Record<string, boolean> | undefined,
  fallback: LabeledValue[]
): LabeledValue[] {
  if (!proposals) return fallback
  return proposals
    .filter((p) => overrides?.[p.key] ?? p.keep)
    .map((p) => ({ value: p.value, label: p.label }))
}

function mergeMembers(
  clusterId: string,
  members: Contact[],
  analysis: AnalysisResult | undefined,
  decisions: Decisions,
  split: boolean
): AlignedContact {
  const chosen = decisions.fields[clusterId] ?? {}
  const diffs = split ? fieldDiffs(members) : analysis?.clusters.find((c) => c.id === clusterId)?.diffs ?? []
  const pick = (field: keyof typeof chosen) =>
    chosen[field] ?? diffs.find((d) => d.field === field)?.suggested ?? suggestValue(members.map((m) => m[field]))

  const displayName = pick('displayName') ?? members[0]?.displayName ?? ''
  // Take structured name parts from the member whose display name won, else the most complete one.
  const nameDonor =
    members.find((m) => foldName(m.displayName) === foldName(displayName) && (m.firstName || m.lastName)) ??
    [...members].sort((a, b) => nameParts(b) - nameParts(a))[0]
  const fallbackSplit = splitName(displayName)

  const proposal = analysis?.proposals[clusterId]
  const emails = keepValues(proposal?.emails, decisions.emails[clusterId], uniqueBy(members.flatMap((m) => m.emails), normalizeEmail))
  const phones = keepValues(proposal?.phones, decisions.phones[clusterId], uniqueBy(members.flatMap((m) => m.phones), normalizePhone))

  return {
    clusterId,
    memberUids: members.map((m) => m.uid),
    displayName,
    firstName: nameDonor?.firstName ?? fallbackSplit.first,
    middleName: nameDonor?.middleName,
    lastName: nameDonor?.lastName ?? fallbackSplit.last,
    nickname: suggestValue(members.map((m) => m.nickname)),
    organization: pick('organization'),
    title: pick('title'),
    birthday: pick('birthday'),
    notes: pick('notes'),
    emails,
    phones,
    addresses: uniqueBy(members.flatMap((m) => m.addresses), (v) => foldName(v))
  }
}

function nameParts(c: Contact) {
  return +!!c.firstName + +!!c.lastName + +!!c.middleName
}

function uniqueBy(values: LabeledValue[], key: (v: string) => string): LabeledValue[] {
  const seen = new Set<string>()
  return values.filter((v) => {
    const k = key(v.value)
    if (!k || seen.has(k)) return false
    seen.add(k)
    return true
  })
}

export function alignContacts(contacts: Contact[], analysis: AnalysisResult, decisions: Decisions): AlignedContact[] {
  const byUid = new Map(contacts.map((c) => [c.uid, c]))
  const out: AlignedContact[] = []
  for (const unit of alignmentUnits(analysis, decisions)) {
    const members = unit.memberUids.map((u) => byUid.get(u)).filter((c): c is Contact => !!c)
    if (members.length) out.push(mergeMembers(unit.id, members, analysis, decisions, unit.id !== unit.cluster.id))
  }
  return out
}

/** Emails a user decided to drop, keyed by match key — used to clean Mail's Previous Recipients. */
export function droppedEmails(analysis: AnalysisResult, decisions: Decisions): Set<string> {
  const dropped = new Set<string>()
  const kept = new Set<string>()
  for (const unit of alignmentUnits(analysis, decisions)) {
    for (const e of analysis.proposals[unit.id]?.emails ?? []) {
      if (decisions.emails[unit.id]?.[e.key] ?? e.keep) kept.add(e.key)
      else dropped.add(e.key)
    }
  }
  // An address one person dropped but another still uses stays.
  for (const k of kept) dropped.delete(k)
  return dropped
}

const setOf = (vs: LabeledValue[], key: (v: string) => string) => vs.map((v) => key(v.value)).join('\n')

export function contactDiffers(before: Contact, after: AlignedContact): boolean {
  return (
    before.displayName !== after.displayName ||
    (before.organization ?? '') !== (after.organization ?? '') ||
    (before.title ?? '') !== (after.title ?? '') ||
    setOf(before.emails, normalizeEmail) !== setOf(after.emails, normalizeEmail) ||
    setOf(before.phones, normalizePhone) !== setOf(after.phones, normalizePhone)
  )
}

export interface PlanOptions {
  /** Add people that exist elsewhere but not in this vendor. */
  createMissing: boolean
  /** Remove extra copies when a vendor holds the same person more than once. */
  deleteDuplicates: boolean
}

export function buildPlans(
  contacts: Contact[],
  aligned: AlignedContact[],
  targets: SourceKind[],
  opts: PlanOptions
): ChangePlan[] {
  const byUid = new Map(contacts.map((c) => [c.uid, c]))
  return targets.map((source) => {
    const ops: PlanOp[] = []
    for (const a of aligned) {
      const inVendor = a.memberUids
        .map((u) => byUid.get(u))
        .filter((c): c is Contact => c?.source === source)
        .sort((x, y) => richness(y) - richness(x))
      if (!inVendor.length) {
        if (opts.createMissing && (a.emails.length || a.phones.length)) ops.push({ op: 'create', source, after: a })
        continue
      }
      const [keep, ...extras] = inVendor
      if (contactDiffers(keep, a)) ops.push({ op: 'update', source, recordId: keep.recordId, etag: keep.etag, before: keep, after: a })
      for (const x of extras) {
        if (opts.deleteDuplicates) ops.push({ op: 'delete', source, recordId: x.recordId, etag: x.etag, before: x })
        else if (contactDiffers(x, a)) ops.push({ op: 'update', source, recordId: x.recordId, etag: x.etag, before: x, after: a })
      }
    }
    return { source, ops }
  })
}

function richness(c: Contact) {
  return c.emails.length + c.phones.length + c.addresses.length + +!!c.organization + +!!c.notes + +!!c.birthday
}

export function clusterMembers(cluster: Cluster, contacts: Map<string, Contact>): Contact[] {
  return cluster.memberUids.map((u) => contacts.get(u)).filter((c): c is Contact => !!c)
}
