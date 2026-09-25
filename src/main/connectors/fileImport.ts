import { readFileSync } from 'node:fs'
import type { Contact, SourceKind } from '@engine/types'
import { isGroupCard, parseVCard } from '@engine/vcard'
import type { Connector } from './types'

/** Split a multi-contact .vcf export into individual cards. */
export function splitVCards(text: string): string[] {
  return text.match(/BEGIN:VCARD[\s\S]*?END:VCARD/gi) ?? []
}

/**
 * Read-only contacts from an exported .vcf file (e.g. contacts.google.com → Export → vCard).
 * No credentials needed; results go back to the vendor as an exported CSV.
 */
export function vcardFile(kind: SourceKind, path: () => string | undefined): Connector {
  const read = () => {
    const p = path()
    if (!p) throw new Error('Choose a contacts file first.')
    const cards = splitVCards(readFileSync(p, 'utf8')).filter((c) => !isGroupCard(c))
    if (!cards.length) throw new Error('No contacts found in that file. Export as vCard (.vcf).')
    return cards
  }
  return {
    kind,
    async test() {
      return `${read().length} contacts in file`
    },
    async fetchContacts() {
      return read().map((raw, i): Contact => {
        const p = parseVCard(raw)
        const id = p.uid ?? `file-${i}`
        return { ...p, uid: `${kind}:${id}`, source: kind, recordId: id }
      })
    }
  }
}
