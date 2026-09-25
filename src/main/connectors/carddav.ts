import { DAVClient } from 'tsdav'
import type { DAVAddressBook, DAVObject } from 'tsdav'
import { randomUUID } from 'node:crypto'
import type { Contact, SourceKind } from '@engine/types'
import { isGroupCard, parseVCard, patchVCard, serializeVCard } from '@engine/vcard'
import { applySequentially, type Connector } from './types'

export interface DavAccount {
  username: string
  password: string
}

export const CARDDAV_SERVERS: Partial<Record<SourceKind, string>> = {
  icloud: 'https://contacts.icloud.com',
  yahoo: 'https://carddav.address.yahoo.com'
}

async function client(serverUrl: string, acct: DavAccount) {
  const c = new DAVClient({
    serverUrl,
    credentials: { username: acct.username, password: acct.password },
    authMethod: 'Basic',
    defaultAccountType: 'carddav'
  })
  try {
    await c.login()
  } catch (err) {
    throw new Error(/401|403|Unauthorized/i.test(String(err)) ? 'Sign-in rejected. Check the username and app-specific password.' : `Could not reach ${serverUrl}: ${String(err)}`)
  }
  return c
}

function assertOk(res: Response) {
  if (!res.ok) {
    const e = new Error(res.status === 412 ? 'Contact changed on the server since it was read (etag mismatch). Re-import and try again.' : `Server returned ${res.status} ${res.statusText}`) as Error & { status: number }
    e.status = res.status
    throw e
  }
}

export function cardDav(kind: SourceKind, serverUrl: string, acct: () => DavAccount | undefined): Connector {
  const need = () => {
    const a = acct()
    if (!a) throw new Error('Not connected')
    return a
  }
  let books: DAVAddressBook[] = []
  const load = async () => {
    const c = await client(serverUrl, need())
    books = await c.fetchAddressBooks()
    if (!books.length) throw new Error('No address books found on this account.')
    return c
  }
  return {
    kind,
    async test() {
      await load()
      return `Connected — ${books.length} address book${books.length === 1 ? '' : 's'}`
    },
    async fetchContacts(ctx) {
      const c = await load()
      const out: Contact[] = []
      for (const book of books) {
        ctx.progress(`${kind}: reading ${book.displayName ?? 'address book'}…`, out.length)
        const cards: DAVObject[] = await c.fetchVCards({ addressBook: book })
        for (const card of cards) {
          if (!card.data || isGroupCard(card.data)) continue
          const p = parseVCard(card.data)
          out.push({ ...p, uid: `${kind}:${card.url}`, source: kind, recordId: card.url, etag: card.etag, raw: card.data })
        }
      }
      return out
    },
    async backup() {
      const c = await load()
      const parts: string[] = []
      for (const book of books) for (const card of await c.fetchVCards({ addressBook: book })) if (card.data) parts.push(card.data.trim())
      return { ext: 'vcf', data: parts.join('\r\n') + '\r\n' }
    },
    async apply(ops, ctx) {
      const c = await load()
      return applySequentially(ops, ctx, async (op) => {
        if (op.op === 'update') {
          assertOk(await c.updateVCard({ vCard: { url: op.recordId, etag: op.etag, data: patchVCard(op.before.raw ?? serializeVCard(op.after, randomUUID()), op.after) } }))
        } else if (op.op === 'delete') {
          assertOk(await c.deleteVCard({ vCard: { url: op.recordId, etag: op.etag } }))
        } else {
          const filename = `${randomUUID()}.vcf`
          const vCardString = op.restoreRaw ?? serializeVCard(op.after, filename.replace('.vcf', ''))
          assertOk(await c.createVCard({ addressBook: books[0], filename, vCardString }))
          return new URL(filename, books[0].url).toString()
        }
      })
    }
  }
}
