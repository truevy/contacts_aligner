import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { UsageAggregator } from '@engine/recency'

// Build tiny databases with the same schema as Apple's and point the connectors at them.
const home = mkdtempSync(join(tmpdir(), 'ca-home-'))
vi.mock('node:os', async (orig) => ({ ...(await orig<typeof import('node:os')>()), homedir: () => home }))

const APPLE_EPOCH = 978307200
const T = (iso: string) => Date.parse(iso) / 1000 // unix seconds

function makeMail() {
  const dir = join(home, 'Library/Mail/V10/MailData')
  mkdirSync(dir, { recursive: true })
  const db = new DatabaseSync(join(dir, 'Envelope Index'))
  db.exec(`
    CREATE TABLE addresses (ROWID INTEGER PRIMARY KEY, address TEXT, comment TEXT);
    CREATE TABLE mailboxes (ROWID INTEGER PRIMARY KEY, url TEXT);
    CREATE TABLE messages (ROWID INTEGER PRIMARY KEY, sender INTEGER, subject TEXT, date_sent INTEGER, mailbox INTEGER);
    CREATE TABLE recipients (ROWID INTEGER PRIMARY KEY, message INTEGER, address INTEGER, type INTEGER);
    INSERT INTO addresses VALUES (1,'me@example.com',''),(2,'matt.new@acme.com','Matt'),(3,'matt.old@initech.com','Matt');
    INSERT INTO mailboxes VALUES (1,'imap://me@example.com/Sent%20Messages'),(2,'imap://me@example.com/INBOX');
    INSERT INTO messages VALUES
      (1,1,'secret subject',${T('2026-08-01')},1),
      (2,1,'secret subject',${T('2018-03-01')},1),
      (3,3,'newsletter',${T('2026-07-01')},2);
    INSERT INTO recipients VALUES (1,1,2,0),(2,2,3,0);
  `)
  db.close()
}

function makeMessages() {
  const dir = join(home, 'Library/Messages')
  mkdirSync(dir, { recursive: true })
  const db = new DatabaseSync(join(dir, 'chat.db'))
  const ns = (iso: string) => (T(iso) - APPLE_EPOCH) * 1e9
  db.exec(`
    CREATE TABLE handle (ROWID INTEGER PRIMARY KEY, id TEXT, service TEXT);
    CREATE TABLE message (ROWID INTEGER PRIMARY KEY, handle_id INTEGER, date INTEGER, is_from_me INTEGER, text TEXT);
    INSERT INTO handle VALUES (1,'+14155550100','iMessage'),(2,'friend@icloud.com','iMessage');
    INSERT INTO message VALUES (1,1,${ns('2026-09-01')},1,'hi'),(2,1,${ns('2026-09-02')},0,'yo'),(3,2,${ns('2025-01-01')},1,'hey');
  `)
  db.close()
}

function makeCalls() {
  const dir = join(home, 'Library/Application Support/CallHistoryDB')
  mkdirSync(dir, { recursive: true })
  const db = new DatabaseSync(join(dir, 'CallHistory.storedata'))
  db.exec(`
    CREATE TABLE ZCALLRECORD (Z_PK INTEGER PRIMARY KEY, ZADDRESS TEXT, ZDATE REAL, ZORIGINATED INTEGER, ZDURATION REAL);
    INSERT INTO ZCALLRECORD VALUES (1,'(415) 555-0199',${T('2026-06-01') - APPLE_EPOCH},1,60),(2,'4155550199',${T('2026-06-10') - APPLE_EPOCH},0,30);
  `)
  db.close()
}

beforeAll(() => {
  makeMail()
  makeMessages()
  makeCalls()
})
afterAll(() => rmSync(home, { recursive: true, force: true }))

const ctx = (usage: UsageAggregator) => ({ progress: () => undefined, usage, since: Date.parse('2010-01-01') })

describe('local macOS readers', () => {
  it('reads Mail: sent recipients are outgoing, others are incoming', async () => {
    const { macMail } = await import('./localMac')
    const usage = new UsageAggregator()
    await macMail.scanUsage!(ctx(usage))
    expect(usage.index['email|matt.new@acme.com']).toMatchObject({ countOut: 1, lastOut: Date.parse('2026-08-01') })
    const old = usage.index['email|matt.old@initech.com']
    expect(old.lastOut).toBe(Date.parse('2018-03-01'))
    expect(old.lastIn).toBe(Date.parse('2026-07-01'))
    expect(usage.index['email|me@example.com']).toBeUndefined()
  })

  it('reads Messages handles, dates and direction', async () => {
    const { messages } = await import('./localMac')
    const usage = new UsageAggregator()
    await messages.scanUsage!(ctx(usage))
    expect(usage.index['message|+14155550100']).toMatchObject({ countOut: 1, countIn: 1, lastIn: Date.parse('2026-09-02') })
    expect(usage.index['message|friend@icloud.com'].countOut).toBe(1)
  })

  it('reads call history and normalizes numbers', async () => {
    const { calls } = await import('./localMac')
    const usage = new UsageAggregator()
    await calls.scanUsage!(ctx(usage))
    expect(usage.index['call|+14155550199']).toMatchObject({ countOut: 1, countIn: 1, lastIn: Date.parse('2026-06-10') })
  })
})
