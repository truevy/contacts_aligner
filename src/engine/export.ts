import Papa from 'papaparse'
import type { AlignedContact, AnalysisResult } from './types'
import { serializeVCard } from './vcard'
import { emailMatchKey, normalizePhone } from './normalize'

export type ExportFormat = 'google-csv' | 'outlook-csv' | 'detailed-csv' | 'vcard'

const cap = (s?: string) => (s ? s[0].toUpperCase() + s.slice(1) : '')

function googleRows(list: AlignedContact[]) {
  const maxE = Math.max(1, ...list.map((a) => a.emails.length))
  const maxP = Math.max(1, ...list.map((a) => a.phones.length))
  return list.map((a) => {
    const row: Record<string, string> = {
      'First Name': a.firstName ?? '',
      'Middle Name': a.middleName ?? '',
      'Last Name': a.lastName ?? '',
      Nickname: a.nickname ?? '',
      Birthday: a.birthday ?? '',
      Notes: a.notes ?? '',
      'Organization Name': a.organization ?? '',
      'Organization Title': a.title ?? ''
    }
    for (let i = 0; i < maxE; i++) {
      row[`E-mail ${i + 1} - Label`] = a.emails[i] ? (i === 0 ? '* ' : '') + cap(a.emails[i].label ?? 'other') : ''
      row[`E-mail ${i + 1} - Value`] = a.emails[i]?.value ?? ''
    }
    for (let i = 0; i < maxP; i++) {
      row[`Phone ${i + 1} - Label`] = a.phones[i] ? cap(a.phones[i].label ?? 'mobile') : ''
      row[`Phone ${i + 1} - Value`] = a.phones[i]?.value ?? ''
    }
    return row
  })
}

function outlookRows(list: AlignedContact[]) {
  return list.map((a) => {
    const byLabel = (re: RegExp) => a.phones.find((p) => re.test(p.label ?? ''))?.value ?? ''
    const mobile = byLabel(/mobile|cell|iphone/) || (a.phones.find((p) => !p.label)?.value ?? '')
    return {
      'First Name': a.firstName ?? '',
      'Middle Name': a.middleName ?? '',
      'Last Name': a.lastName ?? '',
      Company: a.organization ?? '',
      'Job Title': a.title ?? '',
      'E-mail Address': a.emails[0]?.value ?? '',
      'E-mail 2 Address': a.emails[1]?.value ?? '',
      'E-mail 3 Address': a.emails[2]?.value ?? '',
      'Mobile Phone': mobile,
      'Business Phone': byLabel(/work|business|main/),
      'Home Phone': byLabel(/home/),
      Birthday: a.birthday ?? '',
      Notes: a.notes ?? ''
    }
  })
}

function detailedRows(list: AlignedContact[], analysis?: AnalysisResult) {
  const iso = (ms?: number) => (ms ? new Date(ms).toISOString().slice(0, 10) : '')
  return list.map((a) => {
    const p = analysis?.proposals[a.clusterId]
    const e0 = p?.emails.find((e) => e.key === emailMatchKey(a.emails[0]?.value ?? ''))
    const p0 = p?.phones.find((x) => x.key === normalizePhone(a.phones[0]?.value ?? ''))
    return {
      Name: a.displayName,
      Organization: a.organization ?? '',
      Title: a.title ?? '',
      'Primary Email': a.emails[0]?.value ?? '',
      'Primary Email Last Used': iso(e0?.lastUsed),
      'Other Emails': a.emails.slice(1).map((e) => e.value).join('; '),
      'Primary Phone': a.phones[0]?.value ?? '',
      'Primary Phone Last Used': iso(p0?.lastUsed),
      'Other Phones': a.phones.slice(1).map((e) => e.value).join('; '),
      'Merged From': a.memberUids.map((u) => u.split(':')[0]).join(', ')
    }
  })
}

export function exportContacts(list: AlignedContact[], format: ExportFormat, analysis?: AnalysisResult): string {
  switch (format) {
    case 'google-csv':
      return Papa.unparse(googleRows(list))
    case 'outlook-csv':
      return Papa.unparse(outlookRows(list))
    case 'detailed-csv':
      return Papa.unparse(detailedRows(list, analysis))
    case 'vcard':
      return list.map((a, i) => serializeVCard(a, `contacts-aligner-${i}-${Date.now()}`)).join('')
  }
}
