import type { Contact, RecentEntry, SourceKind, UsageIndex } from './types'
import { UsageAggregator, DAY } from './recency'

// Deterministic synthetic data so the whole UI works without any credentials.

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 2 ** 32
  }
}

const FIRST = ['Matthew', 'Sarah', 'David', 'Emily', 'James', 'Olivia', 'Michael', 'Ava', 'Daniel', 'Sophia', 'Chris', 'Grace', 'Robert', 'Hannah', 'William', 'Priya', 'Carlos', 'Mei', 'Ahmed', 'Laura', 'Tom', 'Nina', 'Jonathan', 'Elizabeth', 'Kevin', 'Rachel', 'Sam', 'Zoe']
const NICK: Record<string, string> = { Matthew: 'Matt', Michael: 'Mike', Robert: 'Bob', William: 'Bill', Elizabeth: 'Liz', Jonathan: 'Jon', Daniel: 'Dan', Chris: 'Chris', Tom: 'Tom', Sam: 'Sam' }
const LAST = ['Johnson', 'Nguyen', 'Garcia', 'Smith', 'Patel', 'Kim', 'Brown', 'Rossi', 'Cohen', 'Okafor', 'Silva', 'Müller', 'Walsh', 'Chen', 'Lopez', 'Anderson', 'Tanaka', 'Novak', 'Hughes', 'Fischer']
const COMPANIES = [
  ['Acme Corp', 'acme.com'], ['Globex', 'globex.io'], ['Initech', 'initech.com'], ['Umbrella Health', 'umbrellahealth.org'],
  ['Stark Industries', 'stark.com'], ['Wayne Enterprises', 'wayne.co'], ['Hooli', 'hooli.xyz'], ['Pied Piper', 'piedpiper.com']
]
const FREE = ['gmail.com', 'yahoo.com', 'icloud.com', 'outlook.com', 'hotmail.com', 'aol.com', 'me.com']
const TITLES = ['Engineer', 'Director', 'Designer', 'Product Manager', 'Consultant', 'VP Sales', 'Founder', undefined]
const CONTACT_SOURCES: SourceKind[] = ['google', 'icloud', 'yahoo', 'microsoft', 'exchange', 'apple']

interface Person {
  first: string
  last: string
  company?: [string, string]
  title?: string
  /** Oldest first; the last one is the address actually in use today */
  emails: Array<{ value: string; lastUsedYearsAgo: number | null }>
  phones: Array<{ value: string; label: string; lastUsedYearsAgo: number | null }>
}

export interface DemoData {
  contacts: Contact[]
  usage: UsageIndex
  recents: RecentEntry[]
}

export function makeDemoData(now = Date.now(), count = 260): DemoData {
  const r = rng(42)
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)]
  const phone = () => `+1${pick(['415', '212', '617', '312', '206', '512'])}${String(Math.floor(2000000 + r() * 7999999))}`
  const people: Person[] = []

  // A cluster of Matts with piles of old addresses: the Mac Mail autocomplete problem.
  const matts: Array<[string, string, string[]]> = [
    ['Matthew', 'Johnson', ['mjohnson@initech.com', 'matt.johnson@globex.io', 'mattj1987@yahoo.com', 'matt.johnson@gmail.com']],
    ['Matt', 'Nguyen', ['matt@nguyenfamily.net', 'mnguyen@stark.com', 'mattnguyen@hotmail.com', 'matt.nguyen@icloud.com']],
    ['Matthew', 'Garcia', ['mgarcia@acme.com', 'matthew.garcia@acme.com', 'mattg@aol.com']],
    ['Matt', 'Rossi', ['matt.rossi@hooli.xyz', 'mrossi@piedpiper.com', 'rossi.matt@gmail.com']],
    ['Matthew', 'Kim', ['mkim@wayne.co', 'matthewkim@me.com']],
    ['Matt', 'Walsh', ['matt.walsh@umbrellahealth.org', 'mwalsh@initech.com', 'mattwalsh@yahoo.com', 'walsh.m@outlook.com', 'mattw@gmail.com']]
  ]
  for (const [first, last, emails] of matts) {
    const n = emails.length
    people.push({
      first,
      last,
      company: COMPANIES.find((c) => emails[n - 1].endsWith(c[1])) as [string, string] | undefined,
      title: pick(TITLES),
      emails: emails.map((value, i) => ({
        value,
        lastUsedYearsAgo: i === n - 1 ? r() * 0.3 : i === n - 2 && r() > 0.5 ? 1 + r() * 1.5 : r() > 0.3 ? 3 + (n - i) * 1.5 + r() : null
      })),
      phones: [
        { value: phone(), label: 'mobile', lastUsedYearsAgo: r() * 0.5 },
        ...(r() > 0.5 ? [{ value: phone(), label: 'home', lastUsedYearsAgo: 5 + r() * 4 }] : [])
      ]
    })
  }

  while (people.length < count) {
    const first = pick(FIRST)
    const last = pick(LAST)
    const company = r() > 0.4 ? pick(COMPANIES) as [string, string] : undefined
    const local = `${first.toLowerCase()}.${last.toLowerCase().replace('ü', 'u')}`
    const emailCount = r() < 0.15 ? 0 : r() < 0.55 ? 1 : r() < 0.85 ? 2 : 3
    const emails: Person['emails'] = []
    for (let i = 0; i < emailCount; i++) {
      const domain = i === 0 && company ? company[1] : pick(FREE)
      const value = i === 0 ? `${local}@${domain}` : `${first[0].toLowerCase()}${last.toLowerCase().replace('ü', 'u')}${Math.floor(r() * 99)}@${domain}`
      const current = i === emailCount - 1
      emails.push({ value, lastUsedYearsAgo: current ? r() * 1.5 : r() > 0.35 ? 3.5 + r() * 6 : null })
    }
    const phoneCount = r() < 0.25 ? 0 : r() < 0.7 ? 1 : 2
    const phones: Person['phones'] = []
    for (let i = 0; i < phoneCount; i++) {
      const current = i === 0
      phones.push({ value: phone(), label: current ? 'mobile' : pick(['home', 'work']), lastUsedYearsAgo: current ? (r() > 0.2 ? r() * 2 : null) : r() > 0.4 ? 4 + r() * 5 : null })
    }
    people.push({ first, last, company, title: company ? pick(TITLES) : undefined, emails, phones })
  }

  const contacts: Contact[] = []
  let recordSeq = 0
  const format = (e164: string, style: number) =>
    style === 0 ? e164 : style === 1 ? `(${e164.slice(2, 5)}) ${e164.slice(5, 8)}-${e164.slice(8)}` : `${e164.slice(2, 5)}.${e164.slice(5, 8)}.${e164.slice(8)}`

  for (const p of people) {
    // Each person lives in 1–4 sources, each holding a different, partial copy.
    const nSources = 1 + Math.floor(r() * r() * 4.2)
    const sources = [...CONTACT_SOURCES].sort(() => r() - 0.5).slice(0, nSources)
    // Occasional duplicate within the same vendor
    if (r() < 0.06) sources.push(sources[0])
    for (const source of sources) {
      const useNick = NICK[p.first] && r() < 0.35
      const first = useNick ? NICK[p.first] : p.first
      const emails = p.emails.filter(() => r() > 0.25)
      if (!emails.length && p.emails.length && r() > 0.3) emails.push(p.emails[0])
      const phones = p.phones.filter(() => r() > 0.3)
      const id = `demo-${++recordSeq}`
      contacts.push({
        uid: `${source}:${id}`,
        source,
        recordId: id,
        etag: `"${recordSeq}"`,
        displayName: `${first} ${p.last}`,
        firstName: first,
        lastName: p.last,
        organization: p.company && r() > 0.2 ? (r() > 0.85 ? p.company[0].toUpperCase() : p.company[0]) : undefined,
        title: p.title && r() > 0.4 ? p.title : undefined,
        emails: emails.map((e) => ({ value: r() > 0.9 ? e.value.toUpperCase() : e.value, label: e.value.includes(p.company?.[1] ?? '#') ? 'work' : 'home' })),
        phones: phones.map((ph) => ({ value: format(ph.value, Math.floor(r() * 3)), label: ph.label })),
        addresses: r() > 0.8 ? [{ value: `${Math.floor(r() * 900 + 100)} ${pick(['Oak', 'Pine', 'Main', 'Market'])} St, ${pick(['San Francisco, CA', 'Brooklyn, NY', 'Austin, TX'])}`, label: 'home' }] : [],
        birthday: r() > 0.9 ? `19${70 + Math.floor(r() * 25)}-0${1 + Math.floor(r() * 9)}-1${Math.floor(r() * 9)}` : undefined
      })
    }
  }

  // A few contacts with neither phone nor email (business cards, old imports)
  for (let i = 0; i < 18; i++) {
    const source = pick(CONTACT_SOURCES)
    const id = `demo-${++recordSeq}`
    contacts.push({ uid: `${source}:${id}`, source, recordId: id, displayName: `${pick(FIRST)} ${pick(LAST)}`, emails: [], phones: [], addresses: [], organization: pick(COMPANIES)[0] })
  }

  // Usage history: mail headers, calls and messages.
  const agg = new UsageAggregator()
  const mailSources: SourceKind[] = ['macmail', 'google', 'icloud', 'microsoft']
  const at = (yearsAgo: number) => now - yearsAgo * 365.25 * DAY
  for (const p of people) {
    for (const e of p.emails) {
      if (e.lastUsedYearsAgo === null) continue
      const src = pick(mailSources)
      const events = 1 + Math.floor(r() * (e.lastUsedYearsAgo < 1 ? 40 : 12))
      for (let i = 0; i < events; i++) {
        const t = at(e.lastUsedYearsAgo + (i === 0 ? 0 : r() * 2))
        agg.add(e.value, 'email', r() > 0.45 ? 'out' : 'in', t, src)
      }
    }
    for (const ph of p.phones) {
      if (ph.lastUsedYearsAgo === null) continue
      const calls = Math.floor(r() * 25)
      for (let i = 0; i < calls; i++) agg.add(ph.value, 'call', r() > 0.5 ? 'out' : 'in', at(ph.lastUsedYearsAgo + (i === 0 ? 0 : r() * 2)), 'calls')
      const msgs = Math.floor(r() * 80)
      for (let i = 0; i < msgs; i++) agg.add(ph.value, 'message', r() > 0.5 ? 'out' : 'in', at(ph.lastUsedYearsAgo + (i === 0 ? 0 : r() * 1.5)), 'messages')
    }
  }

  // Mail's Previous Recipients: every address you ever sent to, including dead ones.
  const recents: RecentEntry[] = []
  let rowId = 1
  for (const p of people.slice(0, 120)) {
    for (const e of p.emails) {
      recents.push({ rowId: rowId++, address: e.value, displayName: `${p.first} ${p.last}`, lastDate: e.lastUsedYearsAgo === null ? at(6 + r() * 4) : at(e.lastUsedYearsAgo), count: 1 + Math.floor(r() * 30) })
    }
  }
  recents.push({ rowId: rowId++, address: 'matt@oldstartup.io', displayName: 'Matt', lastDate: at(8), count: 3 })
  recents.push({ rowId: rowId++, address: 'matty.ice@hotmail.com', displayName: 'Matty', lastDate: at(11), count: 2 })

  return { contacts, usage: agg.index, recents }
}
