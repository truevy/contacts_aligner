import type {
  AnalysisResult,
  Channel,
  Cluster,
  ClusterProposal,
  Contact,
  RecentEntry,
  SourceKind,
  UsageIndex,
  UsageStat,
  ValueProposal
} from './types'
import { emailMatchKey, normalizeEmail, normalizePhone } from './normalize'
import { YEAR, buildEmailMatchIndex, combineStats, countSince, lastUsed, sparkline } from './recency'
import { clusterContacts } from './match'

export interface ProposalOptions {
  now: number
  /** Values not used for this many years, while another value is in use, are proposed for removal. */
  staleYears: number
}

export const DEFAULT_OPTIONS: ProposalOptions = { now: Date.now(), staleYears: 3 }

interface Candidate {
  value: string
  key: string
  label?: string
  carriedBy: SourceKind[]
  stat?: UsageStat
}

/**
 * Rank the values of one kind for one person. The primary is the value you most
 * recently reached out to (outgoing beats incoming, because a newsletter still
 * arriving at an old address says nothing about whether you use it).
 */
export function rankValues(cands: Candidate[], opts: ProposalOptions): ValueProposal[] {
  const staleBefore = opts.now - opts.staleYears * YEAR
  const byOut = cands.filter((c) => c.stat?.lastOut).sort((a, b) => b.stat!.lastOut! - a.stat!.lastOut!)
  const byAny = cands.filter((c) => lastUsed(c.stat)).sort((a, b) => lastUsed(b.stat)! - lastUsed(a.stat)!)
  const primary = byOut[0] ?? byAny[0]
  const newest = primary ? lastUsed(primary.stat)! : undefined

  const proposals = cands.map((c): ValueProposal => {
    const lu = lastUsed(c.stat)
    let status: ValueProposal['status']
    if (c === primary) status = 'primary'
    else if (!lu) status = 'no-evidence'
    else if (lu < staleBefore && newest && newest > lu) status = 'stale'
    else status = 'active'
    return {
      value: c.value,
      key: c.key,
      label: c.label,
      status,
      keep: status !== 'stale',
      lastUsed: lu,
      count12mo: countSince(c.stat, opts.now - YEAR),
      countAll: (c.stat?.countIn ?? 0) + (c.stat?.countOut ?? 0),
      spark: sparkline(c.stat, opts.now),
      carriedBy: c.carriedBy
    }
  })
  const order: Record<ValueProposal['status'], number> = { primary: 0, active: 1, 'no-evidence': 2, stale: 3 }
  return proposals.sort((a, b) => order[a.status] - order[b.status] || (b.lastUsed ?? 0) - (a.lastUsed ?? 0))
}

function collect(
  members: Contact[],
  pick: (c: Contact) => Array<{ value: string; label?: string }>,
  keyOf: (v: string) => string
): Candidate[] {
  const map = new Map<string, Candidate>()
  for (const m of members) {
    for (const v of pick(m)) {
      const key = keyOf(v.value)
      if (!key) continue
      const existing = map.get(key)
      if (existing) {
        if (!existing.carriedBy.includes(m.source)) existing.carriedBy.push(m.source)
        existing.label ??= v.label
      } else map.set(key, { value: v.value.trim(), key, label: v.label, carriedBy: [m.source] })
    }
  }
  return [...map.values()]
}

export function proposeForCluster(
  cluster: Cluster,
  byUid: Map<string, Contact>,
  usage: UsageIndex,
  emailIdx: Map<string, UsageStat[]>,
  opts: ProposalOptions
): ClusterProposal {
  const members = cluster.memberUids.map((u) => byUid.get(u)!).filter(Boolean)

  const emails = collect(members, (c) => c.emails, emailMatchKey).map((c) => ({
    ...c,
    value: normalizeEmail(c.value),
    stat: combineStats(c.key, 'email', emailIdx.get(c.key) ?? [])
  }))

  const phoneCands = (channel: Channel | 'both') =>
    collect(members, (c) => c.phones, normalizePhone).map((c) => {
      const call = usage[`call|${c.key}`]
      const msg = usage[`message|${c.key}`]
      const stat =
        channel === 'call' ? call : channel === 'message' ? msg : combineStats(c.key, 'call', [call, msg])
      return { ...c, stat }
    })

  return {
    clusterId: cluster.id,
    emails: rankValues(emails, opts),
    phonesCalls: rankValues(phoneCands('call'), opts),
    phonesMessages: rankValues(phoneCands('message'), opts),
    phones: rankValues(phoneCands('both'), opts)
  }
}

export function analyze(contacts: Contact[], usage: UsageIndex, opts: ProposalOptions = DEFAULT_OPTIONS): AnalysisResult {
  const clusters = clusterContacts(contacts)
  return { clusters, ...proposeAll(clusters, contacts, usage, opts) }
}

/** Separated from analyze() so the stale-years slider can re-run without re-clustering. */
export function proposeAll(clusters: Cluster[], contacts: Contact[], usage: UsageIndex, opts: ProposalOptions) {
  const byUid = new Map(contacts.map((c) => [c.uid, c]))
  const emailIdx = buildEmailMatchIndex(usage)
  const proposals: AnalysisResult['proposals'] = {}
  const overlap: Record<number, number> = {}
  for (const cl of clusters) {
    proposals[cl.id] = proposeForCluster(cl, byUid, usage, emailIdx, opts)
    // Each member also gets its own proposal, used when the group is kept separate.
    if (cl.memberUids.length > 1) {
      for (const u of cl.memberUids) {
        const id = `${cl.id}#${u}`
        proposals[id] = { ...proposeForCluster({ ...cl, id, memberUids: [u] }, byUid, usage, emailIdx, opts), clusterId: id }
      }
    }
    const n = new Set(cl.memberUids.map((u) => byUid.get(u)?.source)).size
    overlap[n] = (overlap[n] ?? 0) + 1
  }
  return { proposals, overlap }
}

export interface RecentsSuggestion {
  entry: RecentEntry
  reason: 'removed-from-contact' | 'old-unknown'
  defaultRemove: boolean
}

/**
 * Mail autocomplete also draws from "Previous Recipients". Entries whose address
 * you've decided to drop from a contact are proposed for removal; entries that are
 * old and belong to nobody are listed but left unchecked.
 */
export function suggestRecentsCleanup(
  recents: RecentEntry[],
  droppedEmails: Set<string>,
  knownEmails: Set<string>,
  opts: ProposalOptions
): RecentsSuggestion[] {
  const staleBefore = opts.now - opts.staleYears * YEAR
  const out: RecentsSuggestion[] = []
  for (const entry of recents) {
    const key = emailMatchKey(entry.address)
    if (droppedEmails.has(key)) out.push({ entry, reason: 'removed-from-contact', defaultRemove: true })
    else if (!knownEmails.has(key) && entry.lastDate && entry.lastDate < staleBefore)
      out.push({ entry, reason: 'old-unknown', defaultRemove: false })
  }
  return out
}
