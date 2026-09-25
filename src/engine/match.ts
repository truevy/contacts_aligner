import type { Cluster, Contact, FieldDiff, FieldName } from './types'
import {
  canonicalFirstNames,
  emailDomain,
  emailMatchKey,
  foldName,
  isFreeMailDomain,
  jaroWinkler,
  normalizePhone,
  splitName
} from './normalize'

export const AUTO_THRESHOLD = 0.85
export const REVIEW_THRESHOLD = 0.55
/** Blocks larger than this are too generic to compare pairwise (e.g. a shared office switchboard). */
const MAX_BLOCK = 40

interface Features {
  c: Contact
  emails: Set<string>
  phones: Set<string>
  firsts: string[]
  firstRaw: string
  last: string
  full: string
  org: string
  domains: Set<string>
}

export function features(c: Contact): Features {
  const split = splitName(c.displayName)
  const first = foldName(c.firstName ?? split.first)
  const last = foldName(c.lastName ?? split.last)
  const emails = new Set(c.emails.map((e) => emailMatchKey(e.value)).filter(Boolean))
  const domains = new Set<string>()
  for (const e of emails) {
    const d = emailDomain(e)
    if (d && !isFreeMailDomain(d)) domains.add(d)
  }
  return {
    c,
    emails,
    phones: new Set(c.phones.map((p) => normalizePhone(p.value)).filter((p) => p.replace(/\D/g, '').length >= 5)),
    firsts: first ? canonicalFirstNames(first.split(' ')[0]) : [],
    firstRaw: first,
    last,
    full: foldName(c.displayName),
    org: foldName(c.organization),
    domains
  }
}

type Relation = 'same' | 'compatible' | 'conflict' | 'unknown'

function nameRelation(a: Features, b: Features): Relation {
  if (!a.full || !b.full) return 'unknown'
  if (a.full === b.full) return 'same'
  const firstMatch =
    a.firsts.length && b.firsts.length
      ? a.firsts.some((f) => b.firsts.includes(f)) || jaroWinkler(a.firstRaw, b.firstRaw) >= 0.92
      : null
  const lastMatch = a.last && b.last ? a.last === b.last || jaroWinkler(a.last, b.last) >= 0.94 : null
  if (firstMatch === false || lastMatch === false) return 'conflict'
  if (firstMatch && lastMatch) return 'compatible'
  return 'unknown'
}

export interface PairScore {
  score: number
  reasons: string[]
}

export function scorePair(a: Features, b: Features): PairScore {
  const reasons: string[] = []
  let score = 0
  const sharedEmail = [...a.emails].find((e) => b.emails.has(e))
  const sharedPhone = [...a.phones].find((p) => b.phones.has(p))
  const rel = nameRelation(a, b)

  if (sharedEmail) {
    score += 0.9
    reasons.push(`Same email ${sharedEmail}`)
  }
  if (sharedPhone) {
    score += 0.85
    reasons.push(`Same phone ${sharedPhone}`)
  }
  if (rel === 'same') {
    score += 0.6
    reasons.push('Identical name')
  } else if (rel === 'compatible') {
    score += 0.5
    reasons.push('Matching name (incl. nicknames)')
  }
  if (rel === 'same' || rel === 'compatible') {
    if (a.org && a.org === b.org) {
      score += 0.3
      reasons.push('Same organization')
    } else if ([...a.domains].some((d) => b.domains.has(d))) {
      score += 0.3
      reasons.push('Same company email domain')
    }
  }
  // Shared identifiers but clearly different people: family members sharing a landline,
  // assistants sharing an inbox. Never auto-merge those.
  if (rel === 'conflict' && (sharedEmail || sharedPhone)) {
    reasons.push('Names differ — possibly a shared number/address')
    return { score: Math.min(score, 0.6), reasons }
  }
  return { score: Math.min(score, 1), reasons }
}

class UnionFind {
  parent = new Map<string, string>()
  find(x: string): string {
    let p = this.parent.get(x) ?? x
    if (p !== x) {
      p = this.find(p)
      this.parent.set(x, p)
    }
    return p
  }
  union(a: string, b: string) {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra !== rb) this.parent.set(ra, rb)
  }
}

export function clusterContacts(contacts: Contact[]): Cluster[] {
  const feats = new Map(contacts.map((c) => [c.uid, features(c)]))
  const blocks = new Map<string, string[]>()
  const addBlock = (k: string, uid: string) => {
    const list = blocks.get(k)
    if (list) list.push(uid)
    else blocks.set(k, [uid])
  }
  for (const f of feats.values()) {
    for (const e of f.emails) addBlock(`e:${e}`, f.c.uid)
    for (const p of f.phones) addBlock(`p:${p}`, f.c.uid)
    if (f.last) for (const fn of f.firsts) addBlock(`n:${f.last}|${fn}`, f.c.uid)
    else if (f.full) addBlock(`f:${f.full}`, f.c.uid)
  }

  const scored = new Map<string, PairScore>()
  for (const uids of blocks.values()) {
    if (uids.length < 2 || uids.length > MAX_BLOCK) continue
    for (let i = 0; i < uids.length; i++) {
      for (let j = i + 1; j < uids.length; j++) {
        const [x, y] = uids[i] < uids[j] ? [uids[i], uids[j]] : [uids[j], uids[i]]
        const key = `${x}\u0000${y}`
        if (scored.has(key)) continue
        scored.set(key, scorePair(feats.get(x)!, feats.get(y)!))
      }
    }
  }

  const uf = new UnionFind()
  const edges: Array<{ a: string; b: string } & PairScore> = []
  for (const [key, s] of scored) {
    if (s.score < REVIEW_THRESHOLD) continue
    const [a, b] = key.split('\u0000')
    uf.union(a, b)
    edges.push({ a, b, ...s })
  }

  const groups = new Map<string, string[]>()
  for (const c of contacts) {
    const root = uf.find(c.uid)
    const list = groups.get(root)
    if (list) list.push(c.uid)
    else groups.set(root, [c.uid])
  }
  const edgesByRoot = new Map<string, typeof edges>()
  for (const e of edges) {
    const root = uf.find(e.a)
    const list = edgesByRoot.get(root)
    if (list) list.push(e)
    else edgesByRoot.set(root, [e])
  }

  const byUid = new Map(contacts.map((c) => [c.uid, c]))
  const clusters: Cluster[] = []
  for (const [root, uids] of groups) {
    uids.sort()
    const es = edgesByRoot.get(root) ?? []
    const score = es.length ? Math.min(...es.map((e) => e.score)) : 1
    const members = uids.map((u) => byUid.get(u)!)
    clusters.push({
      id: `cl:${uids[0]}`,
      memberUids: uids,
      confidence: uids.length === 1 ? 'single' : score >= AUTO_THRESHOLD ? 'auto' : 'review',
      score,
      reasons: [...new Set(es.flatMap((e) => e.reasons))].slice(0, 6),
      diffs: fieldDiffs(members)
    })
  }
  clusters.sort((a, b) => sortName(byUid.get(a.memberUids[0])!).localeCompare(sortName(byUid.get(b.memberUids[0])!)))
  return clusters
}

function sortName(c: Contact): string {
  return foldName(c.displayName) || c.emails[0]?.value || c.phones[0]?.value || ''
}

const DIFF_FIELDS: FieldName[] = ['displayName', 'organization', 'title', 'birthday', 'notes']

export function suggestValue(values: Array<string | undefined>): string | undefined {
  const counts = new Map<string, { value: string; n: number }>()
  for (const v of values) {
    if (!v?.trim()) continue
    const k = foldName(v) || v
    const entry = counts.get(k)
    if (entry) {
      entry.n++
      // Prefer the richer spelling (capitalization, accents) of the same value
      if (v.length > entry.value.length || /[A-Z]/.test(v) && !/[A-Z]/.test(entry.value)) entry.value = v
    } else counts.set(k, { value: v, n: 1 })
  }
  let best: { value: string; n: number } | undefined
  for (const e of counts.values()) {
    if (!best || e.n > best.n || (e.n === best.n && e.value.length > best.value.length)) best = e
  }
  return best?.value
}

export function fieldDiffs(members: Contact[]): FieldDiff[] {
  if (members.length < 2) return []
  const diffs: FieldDiff[] = []
  for (const field of DIFF_FIELDS) {
    const values: Record<string, string | undefined> = {}
    const distinct = new Set<string>()
    for (const m of members) {
      const v = m[field]
      values[m.uid] = v
      if (v?.trim()) distinct.add(foldName(v) || v)
    }
    const missing = members.some((m) => !m[field]?.trim())
    if (distinct.size > 1 || (distinct.size === 1 && missing)) {
      diffs.push({ field, values, suggested: suggestValue(Object.values(values)) })
    }
  }
  return diffs
}
