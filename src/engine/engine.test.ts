import { describe, expect, it } from 'vitest'
import type { Contact } from './types'
import { canonicalFirstNames, emailMatchKey, normalizePhone, splitName } from './normalize'
import { clusterContacts } from './match'
import { UsageAggregator, YEAR } from './recency'
import { analyze } from './proposals'
import { alignContacts, buildPlans, emptyDecisions } from './align'
import { parseVCard, patchVCard } from './vcard'
import { summarize } from './stats'
import { makeDemoData } from './demo'
import { exportContacts } from './export'

const NOW = Date.UTC(2026, 8, 1)

let seq = 0
function contact(source: Contact['source'], name: string, emails: string[] = [], phones: string[] = [], extra: Partial<Contact> = {}): Contact {
  const id = `r${++seq}`
  const [firstName, lastName] = name.split(' ')
  return {
    uid: `${source}:${id}`, source, recordId: id, displayName: name, firstName, lastName,
    emails: emails.map((value) => ({ value })), phones: phones.map((value) => ({ value })), addresses: [], ...extra
  }
}

describe('normalize', () => {
  it('folds gmail dots and plus tags only for matching', () => {
    expect(emailMatchKey('Matt.Johnson+news@GoogleMail.com')).toBe('mattjohnson@gmail.com')
    expect(emailMatchKey('matt.johnson+x@acme.com')).toBe('matt.johnson@acme.com')
  })
  it('normalizes phones to E.164', () => {
    expect(normalizePhone('(415) 555-2671')).toBe('+14155552671')
    expect(normalizePhone('+44 20 7946 0958')).toBe('+442079460958')
  })
  it('knows nicknames', () => {
    expect(canonicalFirstNames('Matt')).toContain('matthew')
    expect(canonicalFirstNames('Chris')).toEqual(expect.arrayContaining(['christopher', 'christine']))
  })
  it('splits Last, First', () => {
    expect(splitName('Johnson, Matt')).toEqual({ first: 'Matt', last: 'Johnson' })
  })
})

describe('clustering', () => {
  it('merges by shared email, phone and nickname-aware name', () => {
    const a = contact('google', 'Matthew Johnson', ['m.johnson@gmail.com'])
    const b = contact('icloud', 'Matt Johnson', ['mjohnson@gmail.com'], ['415-555-2671'])
    const c = contact('yahoo', 'M Johnson', [], ['+1 415 555 2671'])
    const d = contact('apple', 'Sarah Kim', ['sarah@kim.io'])
    const clusters = clusterContacts([a, b, c, d])
    const big = clusters.find((cl) => cl.memberUids.length === 3)!
    expect(big).toBeDefined()
    expect(big.memberUids.sort()).toEqual([a.uid, b.uid, c.uid].sort())
    expect(clusters.find((cl) => cl.memberUids.includes(d.uid))!.confidence).toBe('single')
  })
  it('sends shared numbers with conflicting names to review instead of auto-merging', () => {
    const a = contact('google', 'Robert Smith', [], ['415 555 0100'])
    const b = contact('icloud', 'Alice Smith', [], ['415 555 0100'])
    const [cl] = clusterContacts([a, b])
    expect(cl.memberUids).toHaveLength(2)
    expect(cl.confidence).toBe('review')
  })
  it('records field differences', () => {
    const a = contact('google', 'Matt Rossi', ['m@r.com'], [], { organization: 'Hooli' })
    const b = contact('icloud', 'Matt Rossi', ['m@r.com'], [], { organization: 'Pied Piper' })
    const [cl] = clusterContacts([a, b])
    expect(cl.diffs.map((d) => d.field)).toContain('organization')
  })
})

describe('recency proposals', () => {
  it('keeps the most recently sent-to email and flags old ones as stale', () => {
    const a = contact('google', 'Matt Walsh', ['old@initech.com', 'new@umbrella.org', 'unknown@x.com'])
    const agg = new UsageAggregator()
    agg.add('old@initech.com', 'email', 'out', NOW - 6 * YEAR, 'macmail', 50)
    agg.add('new@umbrella.org', 'email', 'out', NOW - 0.1 * YEAR, 'macmail', 3)
    // Newsletters still hitting the old address don't make it primary
    agg.add('old@initech.com', 'email', 'in', NOW - 0.05 * YEAR, 'macmail')
    const result = analyze([a], agg.index, { now: NOW, staleYears: 3 })
    const emails = result.proposals[result.clusters[0].id].emails
    expect(emails[0]).toMatchObject({ value: 'new@umbrella.org', status: 'primary', keep: true })
    expect(emails.find((e) => e.value === 'unknown@x.com')).toMatchObject({ status: 'no-evidence', keep: true })
    // Incoming mail keeps old@ "active" — it's still reachable — but it isn't primary
    expect(emails.find((e) => e.value === 'old@initech.com')!.status).toBe('active')
  })
  it('marks addresses unused for longer than the threshold as stale', () => {
    const a = contact('google', 'Matt Kim', ['a@x.com', 'b@y.com'])
    const agg = new UsageAggregator()
    agg.add('a@x.com', 'email', 'out', NOW - 5 * YEAR, 'macmail')
    agg.add('b@y.com', 'email', 'out', NOW - 0.2 * YEAR, 'google')
    const r = analyze([a], agg.index, { now: NOW, staleYears: 3 })
    expect(r.proposals[r.clusters[0].id].emails.find((e) => e.value === 'a@x.com')).toMatchObject({ status: 'stale', keep: false })
  })
  it('ranks phones separately for calls and messages', () => {
    const a = contact('apple', 'Ava Chen', [], ['415 555 0101', '415 555 0102'])
    const agg = new UsageAggregator()
    agg.add('+14155550101', 'call', 'out', NOW - 0.1 * YEAR, 'calls')
    agg.add('+14155550102', 'message', 'out', NOW - 0.1 * YEAR, 'messages')
    const r = analyze([a], agg.index, { now: NOW, staleYears: 3 })
    const p = r.proposals[r.clusters[0].id]
    expect(p.phonesCalls[0].key).toBe('+14155550101')
    expect(p.phonesMessages[0].key).toBe('+14155550102')
  })
})

describe('merge decisions', () => {
  it('keeps review matches separate until approved, with per-person proposals', () => {
    const a = contact('google', 'Robert Smith', ['bob@old.com'], ['415 555 0100'])
    const b = contact('icloud', 'Alice Smith', ['alice@x.com'], ['415 555 0100'])
    const analysis = analyze([a, b], {}, { now: NOW, staleYears: 3 })
    expect(analysis.clusters[0].confidence).toBe('review')
    expect(alignContacts([a, b], analysis, emptyDecisions())).toHaveLength(2)
    const merged = alignContacts([a, b], analysis, { ...emptyDecisions(), merge: { [analysis.clusters[0].id]: true } })
    expect(merged).toHaveLength(1)
    expect(analysis.proposals[`${analysis.clusters[0].id}#${a.uid}`].emails.map((e) => e.value)).toEqual(['bob@old.com'])
  })
})

describe('align + plan', () => {
  it('builds per-vendor plans: update one copy, delete in-vendor duplicates', () => {
    const a = contact('google', 'Matt Nguyen', ['matt@n.net'])
    const b = contact('google', 'Matt Nguyen', ['matt@n.net', 'old@stark.com'])
    const c = contact('icloud', 'Matthew Nguyen', ['matt@n.net'], ['4155550199'])
    const agg = new UsageAggregator()
    agg.add('matt@n.net', 'email', 'out', NOW, 'macmail')
    agg.add('old@stark.com', 'email', 'out', NOW - 8 * YEAR, 'macmail')
    const analysis = analyze([a, b, c], agg.index, { now: NOW, staleYears: 3 })
    const aligned = alignContacts([a, b, c], analysis, emptyDecisions())
    expect(aligned).toHaveLength(1)
    expect(aligned[0].emails.map((e) => e.value)).toEqual(['matt@n.net'])
    const [google, icloud, yahoo] = buildPlans([a, b, c], aligned, ['google', 'icloud', 'yahoo'], { createMissing: false, deleteDuplicates: true })
    expect(google.ops.map((o) => o.op).sort()).toEqual(['delete', 'update'])
    expect(icloud.ops.map((o) => o.op)).toEqual(['update'])
    expect(yahoo.ops).toHaveLength(0)
  })
})

describe('vcard', () => {
  const raw = [
    'BEGIN:VCARD', 'VERSION:3.0', 'UID:abc', 'N:Johnson;Matt;;;', 'FN:Matt Johnson',
    'item1.EMAIL;type=INTERNET;type=pref:matt@old.com', 'item1.X-ABLabel:_$!<Other>!$_',
    'EMAIL;type=INTERNET;type=WORK:mj@acme.com', 'TEL;type=CELL:+1 415 555 0100', 'PHOTO;ENCODING=b:AAAA',
    'NOTE:likes \\, commas', 'END:VCARD'
  ].join('\r\n')
  it('parses labels and escapes', () => {
    const c = parseVCard(raw)
    expect(c.emails).toEqual([{ value: 'matt@old.com', label: 'other' }, { value: 'mj@acme.com', label: 'work' }])
    expect(c.notes).toBe('likes , commas')
  })
  it('patches managed fields and keeps the rest', () => {
    const out = patchVCard(raw, { clusterId: 'x', memberUids: [], displayName: 'Matthew Johnson', firstName: 'Matthew', lastName: 'Johnson', emails: [{ value: 'mj@acme.com', label: 'work' }], phones: [{ value: '+14155550100', label: 'mobile' }], addresses: [] })
    expect(out).toContain('PHOTO;ENCODING=b:AAAA')
    expect(out).toContain('UID:abc')
    expect(out).not.toContain('matt@old.com')
    expect(out).not.toContain('X-ABLabel:_$!<Other>')
    const back = parseVCard(out)
    expect(back.displayName).toBe('Matthew Johnson')
    expect(back.emails.map((e) => e.value)).toEqual(['mj@acme.com'])
  })
})

describe('demo data end-to-end', () => {
  it('produces summaries, clusters and exports', () => {
    const demo = makeDemoData(NOW)
    const summary = summarize(demo.contacts)
    expect(summary.length).toBe(6)
    const analysis = analyze(demo.contacts, demo.usage, { now: NOW, staleYears: 3 })
    expect(analysis.clusters.some((c) => c.memberUids.length > 1)).toBe(true)
    const aligned = alignContacts(demo.contacts, analysis, emptyDecisions())
    expect(aligned.length).toBeLessThan(demo.contacts.length)
    const csv = exportContacts(aligned, 'google-csv')
    expect(csv.split('\n')[0]).toContain('E-mail 1 - Value')
  })
})
