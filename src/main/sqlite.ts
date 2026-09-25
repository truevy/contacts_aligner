import { DatabaseSync } from 'node:sqlite'
import { copyFileSync, existsSync, mkdtempSync, openSync, closeSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** True if the file exists and we're allowed to read it (Full Disk Access granted). */
export function canRead(path: string): 'ok' | 'missing' | 'denied' {
  if (!existsSync(path)) {
    // existsSync returns false for TCC-protected paths too; probe the parent directory.
    try {
      closeSync(openSync(path, 'r'))
      return 'ok'
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      return code === 'EPERM' || code === 'EACCES' ? 'denied' : 'missing'
    }
  }
  try {
    closeSync(openSync(path, 'r'))
    return 'ok'
  } catch {
    return 'denied'
  }
}

/**
 * Apple's databases are live and in WAL mode. Copy the db and its WAL/SHM
 * sidecars to a private temp dir and open the copy read-only, so we never lock
 * or modify the original.
 */
export function withSnapshot<T>(path: string, fn: (db: DatabaseSync) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'contacts-aligner-'))
  try {
    const target = join(dir, 'db.sqlite')
    copyFileSync(path, target)
    for (const ext of ['-wal', '-shm']) if (existsSync(path + ext)) copyFileSync(path + ext, target + ext)
    const db = new DatabaseSync(target, { readOnly: false })
    try {
      return fn(db)
    } finally {
      db.close()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

export function columns(db: DatabaseSync, table: string): string[] {
  return (db.prepare(`PRAGMA table_info("${table.replace(/"/g, '')}")`).all() as Array<{ name: string }>).map((r) => r.name)
}

export function tables(db: DatabaseSync): string[] {
  return (db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as Array<{ name: string }>).map((r) => r.name)
}

export function requireColumns(db: DatabaseSync, table: string, needed: string[], what: string) {
  const have = new Set(columns(db, table))
  const missing = needed.filter((c) => !have.has(c))
  if (missing.length) throw new Error(`${what}: unexpected schema (missing ${table}.${missing.join(', ')}). This macOS version may not be supported yet.`)
}
