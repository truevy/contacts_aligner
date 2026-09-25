import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js'

let defaultRegion: CountryCode = 'US'
export function setDefaultRegion(region: string | undefined) {
  if (region && /^[A-Z]{2}$/.test(region)) defaultRegion = region as CountryCode
}

/** Canonical email used for display and storage: trimmed and lowercased. */
export function normalizeEmail(raw: string): string {
  const m = raw.trim().match(/<([^>]+)>/)
  return (m ? m[1] : raw).trim().replace(/^mailto:/i, '').toLowerCase()
}

export function isEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim())
}

const GMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com'])

/** Key used only for matching: folds Gmail dots and +tags, which all reach the same mailbox. */
export function emailMatchKey(raw: string): string {
  const email = normalizeEmail(raw)
  const at = email.lastIndexOf('@')
  if (at < 0) return email
  let local = email.slice(0, at)
  let domain = email.slice(at + 1)
  if (GMAIL_DOMAINS.has(domain)) {
    local = local.replace(/\./g, '')
    domain = 'gmail.com'
  }
  local = local.replace(/\+.*$/, '')
  return `${local}@${domain}`
}

/** E.164 when parseable, otherwise digits only (keeps short codes and oddities matchable). */
export function normalizePhone(raw: string): string {
  const cleaned = raw.trim().replace(/^tel:/i, '')
  const parsed = parsePhoneNumberFromString(cleaned, defaultRegion)
  if (parsed?.isPossible()) return parsed.number
  const digits = cleaned.replace(/[^\d+]/g, '')
  return digits
}

export function formatPhone(e164: string): string {
  const parsed = parsePhoneNumberFromString(e164, defaultRegion)
  if (!parsed) return e164
  return parsed.country === defaultRegion ? parsed.formatNational() : parsed.formatInternational()
}

/** Normalize an identifier of unknown kind (Messages handles can be either). */
export function normalizeIdentifier(raw: string): { kind: 'email' | 'phone'; key: string } | null {
  const s = raw.trim()
  if (!s) return null
  if (s.includes('@')) return isEmail(normalizeEmail(s)) ? { kind: 'email', key: normalizeEmail(s) } : null
  const key = normalizePhone(s)
  return key.replace(/\D/g, '').length >= 5 ? { kind: 'phone', key } : null
}

// Common English nickname groups. Each group collapses to its first entry.
const NICKNAME_GROUPS: string[][] = [
  ['matthew', 'matt', 'matty', 'mat'],
  ['robert', 'rob', 'bob', 'bobby', 'robbie', 'bert'],
  ['william', 'will', 'bill', 'billy', 'willy', 'liam'],
  ['richard', 'rich', 'rick', 'ricky', 'dick', 'richie'],
  ['michael', 'mike', 'mikey', 'mick', 'mickey'],
  ['james', 'jim', 'jimmy', 'jamie'],
  ['john', 'johnny', 'jack', 'jon'],
  ['jonathan', 'jon', 'jonny'],
  ['joseph', 'joe', 'joey'],
  ['thomas', 'tom', 'tommy'],
  ['christopher', 'chris', 'kit'],
  ['christine', 'chris', 'chrissy', 'tina'],
  ['daniel', 'dan', 'danny'],
  ['david', 'dave', 'davey'],
  ['anthony', 'tony'],
  ['andrew', 'andy', 'drew'],
  ['edward', 'ed', 'eddie', 'ted', 'ned'],
  ['steven', 'steve', 'stephen', 'stevie'],
  ['nicholas', 'nick', 'nicky'],
  ['benjamin', 'ben', 'benny'],
  ['samuel', 'sam', 'sammy'],
  ['alexander', 'alex', 'xander', 'sasha'],
  ['alexandra', 'alex', 'alexa', 'sandra', 'sasha'],
  ['patrick', 'pat', 'paddy'],
  ['patricia', 'pat', 'patty', 'trish'],
  ['katherine', 'kate', 'katie', 'kathy', 'kat', 'catherine', 'cathy', 'kathryn'],
  ['elizabeth', 'liz', 'beth', 'betty', 'lizzie', 'eliza', 'libby'],
  ['margaret', 'maggie', 'meg', 'peggy', 'marge'],
  ['jennifer', 'jen', 'jenny'],
  ['jessica', 'jess', 'jessie'],
  ['rebecca', 'becky', 'becca'],
  ['susan', 'sue', 'suzy'],
  ['deborah', 'deb', 'debbie'],
  ['victoria', 'vicky', 'tori'],
  ['gregory', 'greg'],
  ['timothy', 'tim', 'timmy'],
  ['kenneth', 'ken', 'kenny'],
  ['ronald', 'ron', 'ronnie'],
  ['donald', 'don', 'donnie'],
  ['charles', 'charlie', 'chuck', 'chas'],
  ['peter', 'pete'],
  ['philip', 'phil'],
  ['frederick', 'fred', 'freddie'],
  ['lawrence', 'larry'],
  ['jeffrey', 'jeff'],
  ['zachary', 'zach', 'zack'],
  ['nathaniel', 'nate', 'nathan'],
  ['abigail', 'abby'],
  ['samantha', 'sam', 'sammie'],
  ['gabriel', 'gabe'],
  ['raymond', 'ray'],
  ['douglas', 'doug'],
  ['gerald', 'gerry', 'jerry'],
  ['leonard', 'leo', 'len', 'lenny']
]
const NICK_INDEX = new Map<string, string[]>()
for (const group of NICKNAME_GROUPS) {
  for (const n of group) {
    const list = NICK_INDEX.get(n) ?? []
    list.push(group[0])
    NICK_INDEX.set(n, list)
  }
}

/** All canonical forms of a first name (a nickname can belong to several groups, e.g. "chris"). */
export function canonicalFirstNames(first: string): string[] {
  const f = foldName(first)
  return NICK_INDEX.get(f) ?? [f]
}

export function foldName(s: string | undefined): string {
  return (s ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Split a display name when first/last aren't given separately. Handles "Last, First". */
export function splitName(displayName: string): { first?: string; last?: string } {
  const s = displayName.trim()
  if (!s || isEmail(s)) return {}
  if (s.includes(',')) {
    const [last, first] = s.split(',').map((x) => x.trim())
    return { first: first?.split(/\s+/)[0], last }
  }
  const parts = s.split(/\s+/).filter((p) => !/^(mr|mrs|ms|dr|jr|sr|ii|iii|iv)\.?$/i.test(p))
  if (parts.length === 1) return { first: parts[0] }
  return { first: parts[0], last: parts[parts.length - 1] }
}

export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1
  if (!a || !b) return 0
  const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1)
  const aMatch = new Array<boolean>(a.length).fill(false)
  const bMatch = new Array<boolean>(b.length).fill(false)
  let matches = 0
  for (let i = 0; i < a.length; i++) {
    const lo = Math.max(0, i - range)
    const hi = Math.min(i + range + 1, b.length)
    for (let j = lo; j < hi; j++) {
      if (bMatch[j] || a[i] !== b[j]) continue
      aMatch[i] = bMatch[j] = true
      matches++
      break
    }
  }
  if (!matches) return 0
  let t = 0
  let k = 0
  for (let i = 0; i < a.length; i++) {
    if (!aMatch[i]) continue
    while (!bMatch[k]) k++
    if (a[i] !== b[k]) t++
    k++
  }
  const jaro = (matches / a.length + matches / b.length + (matches - t / 2) / matches) / 3
  let prefix = 0
  while (prefix < 4 && a[prefix] === b[prefix]) prefix++
  return jaro + prefix * 0.1 * (1 - jaro)
}

export function emailDomain(email: string): string {
  return normalizeEmail(email).split('@')[1] ?? ''
}

const FREE_MAIL = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'hotmail.com', 'outlook.com', 'live.com',
  'msn.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com', 'comcast.net'
])
export function isFreeMailDomain(domain: string): boolean {
  return FREE_MAIL.has(domain)
}
