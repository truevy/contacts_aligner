import { existsSync, readdirSync, readFileSync, statSync, copyFileSync, mkdirSync, openSync, readSync, closeSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { DatabaseSync } from 'node:sqlite'
import type { DatabaseSync as DB } from 'node:sqlite'
import type { RecentEntry, SourceKind } from '@engine/types'
import type { Connector, Ctx } from './types'
import { canRead, columns, requireColumns, tables, withSnapshot } from '../sqlite'

// Local macOS data. Every query below reads identifiers, timestamps and
// direction only — never subjects, bodies or message text.

const run = promisify(execFile)
const HOME = homedir()
const APPLE_EPOCH = 978307200 // 2001-01-01 in unix seconds

export const PATHS = {
  mailRoot: join(HOME, 'Library/Mail'),
  messages: join(HOME, 'Library/Messages/chat.db'),
  calls: join(HOME, 'Library/Application Support/CallHistoryDB/CallHistory.storedata'),
  recents: join(HOME, 'Library/Containers/com.apple.corerecents.recentsd/Data/Library/Recents/Recents'),
  backups: join(HOME, 'Library/Application Support/MobileSync/Backup')
}

export function mailEnvelopeIndex(): string | undefined {
  let dirs: string[]
  try {
    dirs = readdirSync(PATHS.mailRoot).filter((d) => /^V\d+$/.test(d))
  } catch {
    // Unreadable Mail folder means no Full Disk Access; report the likely path.
    return join(PATHS.mailRoot, 'V10/MailData/Envelope Index')
  }
  dirs.sort((a, b) => Number(b.slice(1)) - Number(a.slice(1)))
  for (const d of dirs) {
    const p = join(PATHS.mailRoot, d, 'MailData/Envelope Index')
    if (existsSync(p)) return p
  }
  return undefined
}

export function diskAccessStatus() {
  const mail = mailEnvelopeIndex()
  return {
    mail: mail ? canRead(mail) : 'missing',
    messages: canRead(PATHS.messages),
    calls: canRead(PATHS.calls),
    recents: canRead(PATHS.recents)
  }
}

interface Row {
  addr: string
  month?: string
  n: number
  last: number
  out?: number
}

function feed(ctx: Ctx, rows: Row[], channel: 'email' | 'call' | 'message', source: SourceKind, toMs: (v: number) => number, dir?: 'in' | 'out') {
  for (const r of rows) {
    if (!r.addr) continue
    ctx.usage.add(String(r.addr), channel, dir ?? (r.out ? 'out' : 'in'), toMs(Number(r.last)), source, Number(r.n))
  }
}

// ---- Mail.app Envelope Index ----------------------------------------------

export const macMail: Connector = {
  kind: 'macmail',
  async test() {
    const path = mailEnvelopeIndex()
    if (!path) throw new Error('Mail.app data not found. Has Mail been set up on this Mac?')
    if (canRead(path) !== 'ok') throw new Error('Full Disk Access is required to read Mail history.')
    return 'Mail history is readable'
  },
  async scanUsage(ctx) {
    const path = mailEnvelopeIndex()!
    ctx.progress('Reading Mail envelope index…')
    withSnapshot(path, (db) => {
      requireColumns(db, 'messages', ['ROWID', 'sender', 'date_sent', 'mailbox'], 'Mail')
      requireColumns(db, 'recipients', ['message', 'address'], 'Mail')
      requireColumns(db, 'addresses', ['ROWID', 'address'], 'Mail')
      requireColumns(db, 'mailboxes', ['ROWID', 'url'], 'Mail')
      const since = Math.floor(ctx.since / 1000)
      // "Me" = anyone who sends from a Sent mailbox.
      db.exec(`CREATE TEMP TABLE me AS
        SELECT DISTINCT m.sender AS id FROM messages m JOIN mailboxes mb ON m.mailbox = mb.ROWID
        WHERE mb.url LIKE '%Sent%' OR mb.url LIKE '%Gesendet%' OR mb.url LIKE '%Envoy%'`)
      const out = db
        .prepare(`SELECT a.address AS addr, COUNT(*) AS n, MAX(m.date_sent) AS last
          FROM recipients r JOIN messages m ON r.message = m.ROWID JOIN addresses a ON r.address = a.ROWID
          WHERE m.sender IN (SELECT id FROM me) AND m.date_sent > ?
          GROUP BY a.address, strftime('%Y-%m', m.date_sent, 'unixepoch')`)
        .all(since) as unknown as Row[]
      feed(ctx, out, 'email', 'macmail', (s) => s * 1000, 'out')
      const inbound = db
        .prepare(`SELECT a.address AS addr, COUNT(*) AS n, MAX(m.date_sent) AS last
          FROM messages m JOIN addresses a ON m.sender = a.ROWID
          WHERE m.sender NOT IN (SELECT id FROM me) AND m.date_sent > ?
          GROUP BY a.address, strftime('%Y-%m', m.date_sent, 'unixepoch')`)
        .all(since) as unknown as Row[]
      feed(ctx, inbound, 'email', 'macmail', (s) => s * 1000, 'in')
      ctx.progress(`Mail: ${out.length + inbound.length} address-months`, out.length + inbound.length)
    })
  }
}

// ---- Messages (chat.db / sms.db) --------------------------------------------

/** Messages stores dates in nanoseconds since 2001 on modern macOS, seconds on older ones. Normalized to seconds in SQL,
 * because nanosecond values overflow JavaScript numbers. */
const MSG_SECONDS = `(CASE WHEN m.date > 100000000000000 THEN m.date / 1000000000 ELSE m.date END)`

function scanChatDb(db: DB, ctx: Ctx, source: SourceKind) {
  requireColumns(db, 'message', ['handle_id', 'date', 'is_from_me'], 'Messages')
  requireColumns(db, 'handle', ['ROWID', 'id'], 'Messages')
  const since = ctx.since / 1000 - APPLE_EPOCH
  const rows = db
    .prepare(`SELECT h.id AS addr, m.is_from_me AS out, COUNT(*) AS n, MAX(${MSG_SECONDS}) AS last
      FROM message m JOIN handle h ON m.handle_id = h.ROWID
      WHERE ${MSG_SECONDS} > ?
      GROUP BY h.id, m.is_from_me, strftime('%Y-%m', ${MSG_SECONDS} + ${APPLE_EPOCH}, 'unixepoch')`)
    .all(since) as unknown as Row[]
  feed(ctx, rows, 'message', source, (s) => (s + APPLE_EPOCH) * 1000)
  return rows.length
}

export const messages: Connector = {
  kind: 'messages',
  async test() {
    if (canRead(PATHS.messages) !== 'ok') throw new Error('Full Disk Access is required to read Messages history.')
    return 'Messages history is readable'
  },
  async scanUsage(ctx) {
    ctx.progress('Reading Messages history…')
    const n = withSnapshot(PATHS.messages, (db) => scanChatDb(db, ctx, 'messages'))
    ctx.progress(`Messages: ${n} handle-months`, n)
  }
}

// ---- Call history (synced from iPhone via Continuity) -----------------------

function scanCallDb(db: DB, ctx: Ctx, source: SourceKind) {
  requireColumns(db, 'ZCALLRECORD', ['ZADDRESS', 'ZDATE', 'ZORIGINATED'], 'Call history')
  const since = ctx.since / 1000 - APPLE_EPOCH
  const rows = db
    .prepare(`SELECT CAST(ZADDRESS AS TEXT) AS addr, ZORIGINATED AS out, COUNT(*) AS n, MAX(ZDATE) AS last
      FROM ZCALLRECORD WHERE ZDATE > ? AND ZADDRESS IS NOT NULL
      GROUP BY addr, ZORIGINATED, strftime('%Y-%m', ZDATE + ${APPLE_EPOCH}, 'unixepoch')`)
    .all(since) as unknown as Row[]
  feed(ctx, rows, 'call', source, (s) => (s + APPLE_EPOCH) * 1000)
  return rows.length
}

export const calls: Connector = {
  kind: 'calls',
  async test() {
    const s = canRead(PATHS.calls)
    if (s === 'missing') throw new Error('No call history on this Mac. Turn on "Calls on Other Devices" on your iPhone, or use an iPhone backup.')
    if (s === 'denied') throw new Error('Full Disk Access is required to read call history.')
    return 'Call history is readable'
  },
  async scanUsage(ctx) {
    ctx.progress('Reading call history…')
    const n = withSnapshot(PATHS.calls, (db) => scanCallDb(db, ctx, 'calls'))
    ctx.progress(`Calls: ${n} number-months`, n)
  }
}

// ---- iPhone backups (unencrypted Finder backups) ----------------------------

export interface BackupInfo {
  path: string
  deviceName: string
  date?: string
  encrypted: boolean
}

function plistString(xml: string, key: string): string | undefined {
  const m = xml.match(new RegExp(`<key>${key}</key>\\s*<(?:string|date)>([^<]*)</`))
  return m?.[1]
}

export function listIphoneBackups(): BackupInfo[] {
  let entries: string[]
  try {
    entries = readdirSync(PATHS.backups)
  } catch {
    return []
  }
  const out: BackupInfo[] = []
  for (const e of entries) {
    const path = join(PATHS.backups, e)
    try {
      if (!statSync(path).isDirectory()) continue
      const info = existsSync(join(path, 'Info.plist')) ? readFileSync(join(path, 'Info.plist'), 'utf8') : ''
      // Encrypted backups encrypt Manifest.db itself, so it won't start with the SQLite header.
      const encrypted = !sqliteHeader(join(path, 'Manifest.db'))
      out.push({ path, deviceName: plistString(info, 'Device Name') ?? e, date: plistString(info, 'Last Backup Date'), encrypted })
    } catch {
      // skip unreadable entries
    }
  }
  return out.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
}

function sqliteHeader(path: string): boolean {
  try {
    const fd = openSync(path, 'r')
    const buf = Buffer.alloc(16)
    readSync(fd, buf, 0, 16, 0)
    closeSync(fd)
    return buf.toString('latin1').startsWith('SQLite format 3')
  } catch {
    return false
  }
}

function backupFile(dir: string, relativePath: string): string | undefined {
  const manifest = join(dir, 'Manifest.db')
  if (!existsSync(manifest)) return undefined
  const db = new DatabaseSync(manifest, { readOnly: true })
  try {
    const row = db
      .prepare(`SELECT fileID FROM Files WHERE domain = 'HomeDomain' AND relativePath = ?`)
      .get(relativePath) as { fileID: string } | undefined
    if (!row) return undefined
    const p = join(dir, row.fileID.slice(0, 2), row.fileID)
    return existsSync(p) ? p : undefined
  } catch (err) {
    if (/not a database|encrypted/i.test(String(err))) throw new Error('This backup is encrypted. Create an unencrypted backup in Finder, or use Continuity call history instead.')
    throw err
  } finally {
    db.close()
  }
}

export function iphoneBackup(dir: string): Connector {
  return {
    kind: 'iphoneBackup',
    async test() {
      if (canRead(join(dir, 'Manifest.db')) !== 'ok') throw new Error('Cannot read this backup. Full Disk Access is required for the MobileSync folder.')
      const sms = backupFile(dir, 'Library/SMS/sms.db')
      const calls = backupFile(dir, 'Library/CallHistoryDB/CallHistory.storedata')
      if (!sms && !calls) throw new Error('No messages or call history found in this backup.')
      return `Found ${[sms && 'messages', calls && 'call history'].filter(Boolean).join(' and ')}`
    },
    async scanUsage(ctx) {
      const sms = backupFile(dir, 'Library/SMS/sms.db')
      if (sms) {
        ctx.progress('Reading iPhone backup messages…')
        withSnapshot(sms, (db) => scanChatDb(db, ctx, 'iphoneBackup'))
      }
      const callDb = backupFile(dir, 'Library/CallHistoryDB/CallHistory.storedata')
      if (callDb) {
        ctx.progress('Reading iPhone backup call history…')
        withSnapshot(callDb, (db) => scanCallDb(db, ctx, 'iphoneBackup'))
      }
    }
  }
}

// ---- Mail "Previous Recipients" (CoreRecents) --------------------------------

interface RecentsSchema {
  table: string
  address: string
  name?: string
  date?: string
  count?: string
}

function recentsSchema(db: DB): RecentsSchema {
  for (const t of tables(db)) {
    const cols = columns(db, t)
    if (!cols.includes('address')) continue
    const name = cols.find((c) => c === 'display_name' || c === 'name')
    if (!name) continue
    return {
      table: t,
      address: 'address',
      name,
      date: cols.find((c) => c === 'last_date' || c === 'date'),
      count: cols.find((c) => c === 'count')
    }
  }
  throw new Error('Unrecognized Previous Recipients database format on this macOS version.')
}

/** CoreRecents stores Apple-epoch seconds. */
const recentsDateToMs = (v: number) => (v > 1e11 ? v : (v + APPLE_EPOCH) * 1000)

export function readRecents(): RecentEntry[] {
  return withSnapshot(PATHS.recents, (db) => {
    const s = recentsSchema(db)
    const rows = db
      .prepare(`SELECT ROWID AS rowId, "${s.address}" AS address, "${s.name}" AS displayName
        ${s.date ? `, "${s.date}" AS lastDate` : ''} ${s.count ? `, "${s.count}" AS count` : ''}
        FROM "${s.table}" WHERE "${s.address}" LIKE '%@%'`)
      .all() as Array<{ rowId: number; address: string; displayName?: string; lastDate?: number; count?: number }>
    return rows.map((r) => ({
      rowId: Number(r.rowId),
      address: String(r.address),
      displayName: r.displayName ? String(r.displayName) : undefined,
      lastDate: r.lastDate ? recentsDateToMs(Number(r.lastDate)) : undefined,
      count: r.count ? Number(r.count) : undefined
    }))
  })
}

/**
 * Removes entries from Mail's Previous Recipients. Mail is quit first, the
 * database is backed up to `backupDir`, and recentsd is restarted afterwards
 * so it reloads. Returns the number of rows deleted.
 */
export async function removeRecents(rowIds: number[], backupDir: string): Promise<number> {
  if (!rowIds.length) return 0
  mkdirSync(backupDir, { recursive: true })
  for (const ext of ['', '-wal', '-shm']) {
    if (existsSync(PATHS.recents + ext)) copyFileSync(PATHS.recents + ext, join(backupDir, 'Recents' + ext))
  }
  await run('osascript', ['-e', 'if application "Mail" is running then tell application "Mail" to quit']).catch(() => undefined)
  const db = new DatabaseSync(PATHS.recents)
  let deleted = 0
  try {
    const s = recentsSchema(db)
    db.exec('BEGIN')
    const del = db.prepare(`DELETE FROM "${s.table}" WHERE ROWID = ?`)
    // Some versions keep per-use rows in a child table keyed by contact_id
    const child = tables(db).find((t) => t !== s.table && columns(db, t).includes('contact_id'))
    const delChild = child ? db.prepare(`DELETE FROM "${child}" WHERE contact_id = ?`) : undefined
    for (const id of rowIds) {
      delChild?.run(id)
      deleted += Number(del.run(id).changes)
    }
    db.exec('COMMIT')
  } catch (err) {
    try {
      db.exec('ROLLBACK')
    } catch {
      /* not in a transaction */
    }
    throw err
  } finally {
    db.close()
  }
  await run('killall', ['recentsd']).catch(() => undefined)
  return deleted
}

export async function restoreRecents(backupDir: string) {
  await run('osascript', ['-e', 'if application "Mail" is running then tell application "Mail" to quit']).catch(() => undefined)
  for (const ext of ['', '-wal', '-shm']) {
    const src = join(backupDir, 'Recents' + ext)
    if (existsSync(src)) copyFileSync(src, PATHS.recents + ext)
  }
  await run('killall', ['recentsd']).catch(() => undefined)
}
