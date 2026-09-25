import { app } from 'electron'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { AlignedContact, Contact } from '@engine/types'
import type { ApplyResult, Connector } from './types'

interface Card {
  id: string
  given?: string
  middle?: string
  family?: string
  nickname?: string
  org?: string
  title?: string
  emails: Array<{ label?: string; value: string }>
  phones: Array<{ label?: string; value: string }>
  addresses?: Array<{ label?: string; value: string }>
  birthday?: string
}

function helperPath(): string {
  const candidates = [
    join(process.resourcesPath ?? '', 'contacts-helper'),
    join(app.getAppPath(), 'native/contacts-helper/build/contacts-helper')
  ]
  const found = candidates.find((p) => existsSync(p))
  if (!found) throw new Error('Contacts helper is not built. Run `npm run build:helper`.')
  return found
}

function runHelper(args: string[], input?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(helperPath(), args)
    const out: Buffer[] = []
    let err = ''
    child.stdout.on('data', (d) => out.push(d))
    child.stderr.on('data', (d) => (err += d))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(out).toString('utf8'))
      else reject(new Error(err.replace(/^ACCESS_DENIED: /, '').trim() || `contacts-helper exited with ${code}`))
    })
    if (input !== undefined) child.stdin.end(input)
    else child.stdin.end()
  })
}

const toCard = (a: AlignedContact) => ({
  given: a.firstName,
  middle: a.middleName,
  family: a.lastName,
  org: a.organization,
  title: a.title,
  emails: a.emails,
  phones: a.phones
})

export const apple: Connector = {
  kind: 'apple',
  async test() {
    const cards = JSON.parse(await runHelper(['list'])) as Card[]
    return `${cards.length} contacts in Apple Contacts`
  },
  async fetchContacts(ctx) {
    ctx.progress('Reading Apple Contacts…')
    const cards = JSON.parse(await runHelper(['list'])) as Card[]
    return cards.map((c): Contact => {
      const name = [c.given, c.middle, c.family].filter(Boolean).join(' ')
      return {
        uid: `apple:${c.id}`,
        source: 'apple',
        recordId: c.id,
        displayName: name || c.org || c.emails[0]?.value || c.phones[0]?.value || '(no name)',
        firstName: c.given || undefined,
        middleName: c.middle || undefined,
        lastName: c.family || undefined,
        nickname: c.nickname || undefined,
        organization: c.org || undefined,
        title: c.title || undefined,
        emails: c.emails,
        phones: c.phones,
        addresses: c.addresses ?? [],
        birthday: c.birthday
      }
    })
  },
  async backup() {
    return { ext: 'vcf', data: await runHelper(['backup']) }
  },
  async apply(ops, ctx) {
    // One helper call for the whole batch; the helper saves each op separately.
    const payload = ops.map((op) => {
      if (op.op === 'update') return { op: 'update', id: op.recordId, card: toCard(op.after) }
      if (op.op === 'delete') return { op: 'delete', id: op.recordId }
      return { op: 'create', card: toCard(op.after) }
    })
    ctx.progress(`apple: saving ${ops.length} changes…`)
    const results = JSON.parse(await runHelper(['apply'], JSON.stringify(payload))) as Array<{ ok: boolean; id?: string; error?: string }>
    return results.map((r, i): ApplyResult => ({
      op: ops[i].op,
      recordId: ops[i].op === 'create' ? undefined : (ops[i] as { recordId: string }).recordId,
      ok: r.ok,
      error: r.error,
      createdId: ops[i].op === 'create' ? r.id : undefined
    }))
  }
}
