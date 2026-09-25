import { ImapFlow } from 'imapflow'
import type { SourceKind } from '@engine/types'
import type { Connector, Ctx } from './types'

export const IMAP_HOSTS: Partial<Record<SourceKind, string>> = {
  icloud: 'imap.mail.me.com',
  yahoo: 'imap.mail.yahoo.com'
}

/** Most messages we'll read headers for per mailbox; plenty to find the last-used address. */
const MAX_PER_MAILBOX = 25000

/**
 * Scans Sent and Inbox envelopes (From/To/Cc/Date only). Message bodies are never fetched.
 */
export async function scanImap(kind: SourceKind, host: string, user: string, pass: string, ctx: Ctx) {
  const client = new ImapFlow({ host, port: 993, secure: true, auth: { user, pass }, logger: false })
  await client.connect()
  try {
    const boxes = await client.list()
    const sent = boxes.find((b) => b.specialUse === '\\Sent') ?? boxes.find((b) => /sent/i.test(b.path))
    const targets = [
      ...(sent ? [{ path: sent.path, dir: 'out' as const }] : []),
      { path: 'INBOX', dir: 'in' as const }
    ]
    for (const t of targets) {
      const lock = await client.getMailboxLock(t.path, { readOnly: true })
      try {
        const uids = (await client.search({ since: new Date(ctx.since) }, { uid: true })) || []
        const recent = uids.slice(-MAX_PER_MAILBOX)
        if (!recent.length) continue
        let n = 0
        for await (const msg of client.fetch(recent, { envelope: true, internalDate: true }, { uid: true })) {
          const env = msg.envelope
          const date = (env?.date ?? msg.internalDate) as Date | string | undefined
          const at = date ? new Date(date).getTime() : 0
          const people = t.dir === 'out' ? [...(env?.to ?? []), ...(env?.cc ?? [])] : env?.from ?? []
          for (const p of people) if (p.address) ctx.usage.add(p.address, 'email', t.dir, at, kind)
          if (++n % 500 === 0) ctx.progress(`${kind} ${t.path}: ${n}/${recent.length} headers`, n)
        }
      } finally {
        lock.release()
      }
    }
  } finally {
    await client.logout().catch(() => undefined)
  }
}

export function imapUsage(kind: SourceKind, host: string, creds: () => { username: string; password: string } | undefined): Pick<Connector, 'scanUsage'> {
  return {
    async scanUsage(ctx) {
      const c = creds()
      if (!c) return
      ctx.progress(`${kind}: scanning mail headers…`)
      await scanImap(kind, host, c.username, c.password, ctx)
    }
  }
}

/** Log in and out, to validate an app password without scanning anything. */
export async function testImapLogin(host: string, user: string, pass: string) {
  const client = new ImapFlow({ host, port: 993, secure: true, auth: { user, pass }, logger: false })
  try {
    await client.connect()
  } catch {
    throw new Error('Gmail rejected the app password. Check the address and paste the 16-character app password again.')
  }
  await client.logout().catch(() => undefined)
}
