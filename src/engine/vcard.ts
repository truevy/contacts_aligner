import type { AlignedContact, LabeledValue } from './types'

// Minimal vCard 3.0/4.0 reader and writer, enough for CardDAV round-trips.
// Writes patch only the fields we manage so photos, custom fields, dates and
// related names survive untouched.

export interface ParsedVCard {
  uid?: string
  displayName: string
  firstName?: string
  middleName?: string
  lastName?: string
  nickname?: string
  organization?: string
  title?: string
  emails: LabeledValue[]
  phones: LabeledValue[]
  addresses: LabeledValue[]
  birthday?: string
  notes?: string
}

interface Line {
  group?: string
  name: string
  params: Record<string, string[]>
  value: string
  raw: string
}

const unfold = (text: string) => text.replace(/\r?\n[ \t]/g, '')

export function unescapeValue(v: string): string {
  return v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1')
}

export function escapeValue(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1')
}

/** Split on separators that aren't backslash-escaped. */
function splitUnescaped(v: string, sep: string): string[] {
  const out: string[] = []
  let cur = ''
  for (let i = 0; i < v.length; i++) {
    if (v[i] === '\\' && i + 1 < v.length) {
      cur += v[i] + v[i + 1]
      i++
    } else if (v[i] === sep) {
      out.push(cur)
      cur = ''
    } else cur += v[i]
  }
  out.push(cur)
  return out
}

function parseLines(text: string): Line[] {
  const lines: Line[] = []
  for (const raw of unfold(text).split(/\r?\n/)) {
    if (!raw.trim()) continue
    // The value starts at the first colon that isn't inside a quoted param
    let inQuote = false
    let colon = -1
    for (let i = 0; i < raw.length; i++) {
      if (raw[i] === '"') inQuote = !inQuote
      else if (raw[i] === ':' && !inQuote) {
        colon = i
        break
      }
    }
    if (colon < 0) continue
    const head = raw.slice(0, colon)
    const value = raw.slice(colon + 1)
    const [nameWithGroup, ...paramParts] = head.split(';')
    const dot = nameWithGroup.indexOf('.')
    const group = dot > 0 ? nameWithGroup.slice(0, dot) : undefined
    const name = (dot > 0 ? nameWithGroup.slice(dot + 1) : nameWithGroup).toUpperCase()
    const params: Record<string, string[]> = {}
    for (const p of paramParts) {
      const eq = p.indexOf('=')
      const key = (eq < 0 ? 'TYPE' : p.slice(0, eq)).toUpperCase()
      const vals = (eq < 0 ? p : p.slice(eq + 1)).replace(/"/g, '').split(',')
      params[key] = [...(params[key] ?? []), ...vals]
    }
    lines.push({ group, name, params, value, raw })
  }
  return lines
}

const SKIP_TYPES = new Set(['internet', 'pref', 'voice', 'x400'])

/** Apple wraps built-in labels as _$!<Home>!$_ */
export function cleanLabel(label: string | undefined): string | undefined {
  if (!label) return undefined
  const m = label.match(/^_\$!<(.+)>!\$_$/)
  return (m ? m[1] : label).trim().toLowerCase() || undefined
}

function labelFor(line: Line, groupLabels: Map<string, string>): string | undefined {
  if (line.group && groupLabels.has(line.group)) return cleanLabel(groupLabels.get(line.group))
  const types = (line.params.TYPE ?? []).map((t) => t.toLowerCase()).filter((t) => !SKIP_TYPES.has(t))
  return types[0]
}

export function isGroupCard(text: string): boolean {
  return /^(X-ADDRESSBOOKSERVER-KIND|KIND):group/im.test(unfold(text))
}

export function parseVCard(text: string): ParsedVCard {
  const lines = parseLines(text)
  const groupLabels = new Map<string, string>()
  for (const l of lines) if (l.group && l.name === 'X-ABLABEL') groupLabels.set(l.group, unescapeValue(l.value))

  const card: ParsedVCard = { displayName: '', emails: [], phones: [], addresses: [] }
  for (const l of lines) {
    const v = unescapeValue(l.value)
    switch (l.name) {
      case 'UID':
        card.uid = l.value
        break
      case 'FN':
        card.displayName = v.trim()
        break
      case 'N': {
        const [last, first, middle] = splitUnescaped(l.value, ';').map((x) => unescapeValue(x).trim())
        card.lastName = last || undefined
        card.firstName = first || undefined
        card.middleName = middle || undefined
        break
      }
      case 'NICKNAME':
        card.nickname = v.trim() || undefined
        break
      case 'ORG':
        card.organization = unescapeValue(splitUnescaped(l.value, ';')[0]).trim() || undefined
        break
      case 'TITLE':
        card.title = v.trim() || undefined
        break
      case 'EMAIL':
        if (v.trim()) card.emails.push({ value: v.trim(), label: labelFor(l, groupLabels) })
        break
      case 'TEL':
        if (v.trim()) card.phones.push({ value: v.replace(/^tel:/i, '').trim(), label: labelFor(l, groupLabels) })
        break
      case 'ADR': {
        const parts = splitUnescaped(l.value, ';').map((x) => unescapeValue(x).trim()).filter(Boolean)
        if (parts.length) card.addresses.push({ value: parts.join(', '), label: labelFor(l, groupLabels) })
        break
      }
      case 'BDAY':
        card.birthday = v.trim() || undefined
        break
      case 'NOTE':
        card.notes = v.trim() || undefined
        break
    }
  }
  if (!card.displayName) {
    card.displayName =
      [card.firstName, card.middleName, card.lastName].filter(Boolean).join(' ') ||
      card.organization ||
      card.emails[0]?.value ||
      card.phones[0]?.value ||
      ''
  }
  return card
}

const STD_EMAIL_TYPES = new Set(['home', 'work', 'other'])
const STD_TEL_TYPES = new Set(['home', 'work', 'cell', 'mobile', 'fax', 'pager', 'main', 'iphone', 'other'])

function valueLines(kind: 'EMAIL' | 'TEL', values: LabeledValue[], nextItem: () => string): string[] {
  const out: string[] = []
  values.forEach((v, i) => {
    const label = v.label?.toLowerCase()
    const std = kind === 'EMAIL' ? STD_EMAIL_TYPES : STD_TEL_TYPES
    const pref = i === 0 ? ',pref' : ''
    const base = kind === 'EMAIL' ? 'INTERNET' : 'VOICE'
    if (!label || std.has(label)) {
      const t = label ? (label === 'mobile' ? 'CELL' : label.toUpperCase()) : ''
      out.push(`${kind};TYPE=${base}${t ? ',' + t : ''}${pref}:${escapeValue(v.value)}`)
    } else {
      const item = nextItem()
      out.push(`${item}.${kind};TYPE=${base}${pref}:${escapeValue(v.value)}`)
      out.push(`${item}.X-ABLabel:${escapeValue(v.label!)}`)
    }
  })
  return out
}

function managedLines(a: AlignedContact, startItem: number): string[] {
  let item = startItem
  const nextItem = () => `item${item++}`
  const lines = [
    `N:${[a.lastName, a.firstName, a.middleName, '', ''].map((x) => escapeValue(x ?? '')).join(';')}`,
    `FN:${escapeValue(a.displayName)}`
  ]
  if (a.organization) lines.push(`ORG:${escapeValue(a.organization)}`)
  if (a.title) lines.push(`TITLE:${escapeValue(a.title)}`)
  lines.push(...valueLines('EMAIL', a.emails, nextItem), ...valueLines('TEL', a.phones, nextItem))
  return lines
}

const MANAGED = new Set(['FN', 'N', 'ORG', 'TITLE', 'EMAIL', 'TEL'])

/** Replace the managed fields of an existing vCard, leaving everything else as it was. */
export function patchVCard(raw: string, a: AlignedContact): string {
  const lines = parseLines(raw)
  const droppedGroups = new Set<string>()
  const usedGroups = new Set<string>()
  for (const l of lines) {
    if (!l.group) continue
    if (MANAGED.has(l.name)) droppedGroups.add(l.group)
    else if (l.name !== 'X-ABLABEL') usedGroups.add(l.group)
  }
  // A group label belongs to the managed field it was attached to, unless something else shares the group.
  for (const g of usedGroups) droppedGroups.delete(g)

  const kept = lines.filter((l) => {
    if (MANAGED.has(l.name)) return false
    if (l.group && droppedGroups.has(l.group) && l.name === 'X-ABLABEL') return false
    return l.name !== 'END'
  })
  const maxItem = Math.max(
    0,
    ...lines.map((l) => Number(l.group?.match(/^item(\d+)$/i)?.[1] ?? 0))
  )
  const out = [...kept.map((l) => l.raw), ...managedLines(a, maxItem + 1), 'END:VCARD']
  return out.map(fold).join('\r\n') + '\r\n'
}

export function serializeVCard(a: AlignedContact, uid: string): string {
  const lines = ['BEGIN:VCARD', 'VERSION:3.0', 'PRODID:-//Contacts Aligner//EN', `UID:${uid}`, ...managedLines(a, 1)]
  if (a.nickname) lines.push(`NICKNAME:${escapeValue(a.nickname)}`)
  for (const adr of a.addresses) lines.push(`ADR${adr.label ? ';TYPE=' + adr.label.toUpperCase() : ''}:;;${escapeValue(adr.value)};;;;`)
  if (a.birthday) lines.push(`BDAY:${a.birthday}`)
  if (a.notes) lines.push(`NOTE:${escapeValue(a.notes)}`)
  lines.push('END:VCARD')
  return lines.map(fold).join('\r\n') + '\r\n'
}

/** RFC 6350 line folding at 75 octets. */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line)
  if (bytes.length <= 75) return line
  const out: string[] = []
  let cur = ''
  let curLen = 0
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length
    if (curLen + n > (out.length ? 74 : 75)) {
      out.push(cur)
      cur = ''
      curLen = 0
    }
    cur += ch
    curLen += n
  }
  out.push(cur)
  return out.join('\r\n ')
}
