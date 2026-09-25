import type { Channel, Direction, SourceKind, UsageIndex, UsageStat } from './types'
import { emailMatchKey, normalizeIdentifier } from './normalize'

export const DAY = 86_400_000
export const YEAR = 365.25 * DAY

export function monthKey(ms: number): string {
  const d = new Date(ms)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/**
 * Collects usage events from mail, calls and messages into per-identifier stats.
 * Connectors call add() with pre-aggregated counts where they can (SQL GROUP BY),
 * so millions of messages never need to cross IPC.
 */
export class UsageAggregator {
  index: UsageIndex = {}

  add(
    rawIdentifier: string,
    channel: Channel,
    direction: Direction,
    at: number,
    source: SourceKind,
    count = 1
  ) {
    if (!Number.isFinite(at) || at <= 0) return
    const id = normalizeIdentifier(rawIdentifier)
    if (!id) return
    const k = `${channel}|${id.key}`
    let s = this.index[k]
    if (!s) {
      s = this.index[k] = { key: id.key, channel, countIn: 0, countOut: 0, months: {}, sources: [] }
    }
    if (direction === 'out') {
      s.countOut += count
      if (!s.lastOut || at > s.lastOut) s.lastOut = at
    } else {
      s.countIn += count
      if (!s.lastIn || at > s.lastIn) s.lastIn = at
    }
    const m = monthKey(at)
    s.months[m] = (s.months[m] ?? 0) + count
    if (!s.sources.includes(source)) s.sources.push(source)
  }

  merge(other: UsageIndex) {
    for (const [k, o] of Object.entries(other)) {
      const s = this.index[k]
      if (!s) {
        this.index[k] = structuredClone(o)
        continue
      }
      s.countIn += o.countIn
      s.countOut += o.countOut
      if (o.lastIn && (!s.lastIn || o.lastIn > s.lastIn)) s.lastIn = o.lastIn
      if (o.lastOut && (!s.lastOut || o.lastOut > s.lastOut)) s.lastOut = o.lastOut
      for (const [m, n] of Object.entries(o.months)) s.months[m] = (s.months[m] ?? 0) + n
      for (const src of o.sources) if (!s.sources.includes(src)) s.sources.push(src)
    }
  }
}

export function combineStats(key: string, channel: Channel, stats: Array<UsageStat | undefined>): UsageStat | undefined {
  const present = stats.filter((s): s is UsageStat => !!s)
  if (!present.length) return undefined
  const agg = new UsageAggregator()
  for (const s of present) agg.merge({ x: { ...s, key, channel } })
  return agg.index.x
}

/** Email usage keyed by match key so j.smith@gmail.com and jsmith+news@gmail.com share history. */
export function buildEmailMatchIndex(index: UsageIndex): Map<string, UsageStat[]> {
  const map = new Map<string, UsageStat[]>()
  for (const s of Object.values(index)) {
    if (s.channel !== 'email' || !s.key.includes('@')) continue
    const mk = emailMatchKey(s.key)
    const list = map.get(mk)
    if (list) list.push(s)
    else map.set(mk, [s])
  }
  return map
}

export function lastUsed(s: UsageStat | undefined): number | undefined {
  if (!s) return undefined
  const v = Math.max(s.lastIn ?? 0, s.lastOut ?? 0)
  return v || undefined
}

export function countSince(s: UsageStat | undefined, since: number): number {
  if (!s) return 0
  const from = monthKey(since)
  let n = 0
  for (const [m, c] of Object.entries(s.months)) if (m >= from) n += c
  return n
}

export function sparkline(s: UsageStat | undefined, now: number, months = 24): number[] {
  const out: number[] = []
  const d = new Date(now)
  for (let i = months - 1; i >= 0; i--) {
    const at = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 15)
    out.push(s?.months[monthKey(at)] ?? 0)
  }
  return out
}

export function relativeTime(ms: number | undefined, now = Date.now()): string {
  if (!ms) return 'never seen'
  const diff = now - ms
  if (diff < DAY) return 'today'
  const days = Math.floor(diff / DAY)
  if (days < 14) return `${days} day${days === 1 ? '' : 's'} ago`
  if (days < 60) return `${Math.floor(days / 7)} wk ago`
  if (days < 365) return `${Math.floor(days / 30)} mo ago`
  const years = diff / YEAR
  return `${years < 2 ? years.toFixed(1) : Math.floor(years)} yr ago`
}
