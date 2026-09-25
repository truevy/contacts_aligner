import type { AlignedContact, Contact, PlanOp, SourceKind } from '@engine/types'
import type { UsageAggregator } from '@engine/recency'

export interface Ctx {
  progress(message: string, count?: number): void
  usage: UsageAggregator
  /** Only scan usage newer than this (ms). */
  since: number
}

export interface ApplyResult {
  op: PlanOp['op']
  recordId?: string
  ok: boolean
  error?: string
  /** Set on create: the vendor's new id, so undo can delete it. */
  createdId?: string
}

export interface Connector {
  kind: SourceKind
  /** Validate stored credentials; throws with a friendly message on failure. */
  test(): Promise<string>
  fetchContacts?(ctx: Ctx): Promise<Contact[]>
  scanUsage?(ctx: Ctx): Promise<void>
  /** Full snapshot in the vendor's native format, written before any push. */
  backup?(): Promise<{ ext: string; data: string }>
  apply?(ops: PlanOp[], ctx: Ctx): Promise<ApplyResult[]>
}

export function contactToAligned(c: Contact): AlignedContact {
  return {
    clusterId: c.uid,
    memberUids: [c.uid],
    displayName: c.displayName,
    firstName: c.firstName,
    middleName: c.middleName,
    lastName: c.lastName,
    nickname: c.nickname,
    organization: c.organization,
    title: c.title,
    birthday: c.birthday,
    notes: c.notes,
    emails: c.emails,
    phones: c.phones,
    addresses: c.addresses
  }
}

/** Run ops one by one with a small delay; vendors rate-limit bulk writes. */
export async function applySequentially(
  ops: PlanOp[],
  ctx: Ctx,
  fn: (op: PlanOp) => Promise<string | void>
): Promise<ApplyResult[]> {
  const results: ApplyResult[] = []
  let i = 0
  for (const op of ops) {
    const recordId = op.op === 'create' ? undefined : op.recordId
    try {
      const createdId = await withRetry(() => fn(op))
      results.push({ op: op.op, recordId, ok: true, createdId: createdId || undefined })
    } catch (err) {
      results.push({ op: op.op, recordId, ok: false, error: errorMessage(err) })
    }
    ctx.progress(`${op.source}: ${++i}/${ops.length}`, i)
    await sleep(120)
  }
  return results
}

export async function withRetry<T>(fn: () => Promise<T>, tries = 4): Promise<T> {
  let delay = 1000
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn()
    } catch (err) {
      const status = (err as { status?: number; code?: number }).status ?? (err as { code?: number }).code
      if (attempt >= tries || !(status === 429 || (typeof status === 'number' && status >= 500))) throw err
      await sleep(delay)
      delay *= 2
    }
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

export function httpError(status: number, body: string): Error & { status: number } {
  const e = new Error(`HTTP ${status}: ${body.slice(0, 300)}`) as Error & { status: number }
  e.status = status
  return e
}

/** Pull addresses out of a raw To/Cc/From header value. */
export function addressesIn(header: string | undefined | null): string[] {
  if (!header) return []
  return header.match(/[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? []
}

export function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i], i)
    }
  }
  return Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker)).then(() => results)
}
