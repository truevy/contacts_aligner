import { app } from 'electron'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { AlignedContact, Contact, SourceKind } from '@engine/types'
import { vault } from '../vault'
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
  container?: string
}

/** An account shown in Contacts.app: iCloud, Google, Exchange, "On My Mac"… */
export interface MacContainer {
  id: string
  name: string
  type: 'local' | 'exchange' | 'cardDAV' | 'unassigned'
  count: number
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

export async function listContainers(): Promise<MacContainer[]> {
  return JSON.parse(await runHelper(['containers'])) as MacContainer[]
}

interface Scope {
  include?: string[]
  exclude?: string[]
}

function scopeArgs(scope: Scope): string[] {
  if (scope.include && !scope.include.length) throw new Error('No account selected.')
  return [
    ...(scope.include ? ['--include', scope.include.join(',')] : []),
    ...(scope.exclude?.length ? ['--exclude', scope.exclude.join(',')] : [])
  ]
}

/** Containers another source reads through this Mac (e.g. the Google account), so Apple Contacts doesn't count them twice. */
export function claimedContainers(): string[] {
  const g = vault.get<{ mode?: string; containerIds?: string[] }>('google')
  return g?.mode === 'mac' ? g.containerIds ?? [] : []
}

/**
 * Contacts through the macOS Contacts framework, limited to some accounts.
 * Changes are saved locally and macOS syncs them to the account's server.
 */
export function contactsFramework(kind: SourceKind, scope: () => Scope): Connector {
  return {
    kind,
    async test() {
      const cards = JSON.parse(await runHelper(['list', ...scopeArgs(scope())])) as Card[]
      return `${cards.length} contacts found`
    },
    async fetchContacts(ctx) {
      ctx.progress('Reading contacts through macOS…')
      const cards = JSON.parse(await runHelper(['list', ...scopeArgs(scope())])) as Card[]
      return cards.map((c): Contact => {
        const name = [c.given, c.middle, c.family].filter(Boolean).join(' ')
        return {
          uid: `${kind}:${c.id}`,
          source: kind,
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
      return { ext: 'vcf', data: await runHelper(['backup', ...scopeArgs(scope())]) }
    },
    async apply(ops, ctx) {
      // New cards go into the first selected account (e.g. the Google account), not the default one.
      const container = scope().include?.[0]
      const payload = ops.map((op) => {
        if (op.op === 'update') return { op: 'update', id: op.recordId, card: toCard(op.after) }
        if (op.op === 'delete') return { op: 'delete', id: op.recordId }
        return { op: 'create', card: toCard(op.after), container }
      })
      ctx.progress(`${kind}: saving ${ops.length} changes…`)
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
}

export const apple = contactsFramework('apple', () => ({ exclude: claimedContainers() }))
