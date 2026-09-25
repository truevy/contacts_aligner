import type { Contact, SourceKind, SourceSummary } from './types'

export function summarize(contacts: Contact[]): SourceSummary[] {
  const by = new Map<SourceKind, SourceSummary>()
  for (const c of contacts) {
    let s = by.get(c.source)
    if (!s) {
      s = { source: c.source, total: 0, noPhoneNoEmail: 0, emailNoPhone: 0, multipleEmails: 0, multiplePhones: 0 }
      by.set(c.source, s)
    }
    const e = c.emails.length
    const p = c.phones.length
    s.total++
    if (!e && !p) s.noPhoneNoEmail++
    if (e && !p) s.emailNoPhone++
    if (e > 1) s.multipleEmails++
    if (p > 1) s.multiplePhones++
  }
  return [...by.values()]
}

export function totals(summaries: SourceSummary[]): Omit<SourceSummary, 'source'> & { source: 'all' } {
  const t = { source: 'all' as const, total: 0, noPhoneNoEmail: 0, emailNoPhone: 0, multipleEmails: 0, multiplePhones: 0 }
  for (const s of summaries) {
    t.total += s.total
    t.noPhoneNoEmail += s.noPhoneNoEmail
    t.emailNoPhone += s.emailNoPhone
    t.multipleEmails += s.multipleEmails
    t.multiplePhones += s.multiplePhones
  }
  return t
}
