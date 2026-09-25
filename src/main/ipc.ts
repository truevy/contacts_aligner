import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import type { ChangePlan, SourceKind } from '@engine/types'
import { UsageAggregator, YEAR } from '@engine/recency'
import { vault } from './vault'
import { session } from './session'
import { getConnector } from './connectors'
import { googleSignIn, parseClientJson } from './connectors/google'
import { microsoftSignIn } from './connectors/microsoft'
import { diskAccessStatus, listIphoneBackups, readRecents } from './connectors/localMac'
import { executePush, listJournals, undoPush } from './push'
import { errorMessage } from './connectors/types'

// Only these hosts may be opened from the renderer (setup helpers link to consoles).
const OPEN_ALLOW = [
  'console.cloud.google.com', 'myaccount.google.com', 'portal.azure.com', 'entra.microsoft.com',
  'account.apple.com', 'appleid.apple.com', 'login.yahoo.com', 'help.yahoo.com', 'support.apple.com',
  'learn.microsoft.com', 'support.google.com'
]

const PRIVACY_PANES: Record<string, string> = {
  fullDisk: 'x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_AllFiles',
  contacts: 'x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Contacts'
}

export type ConnectPayload = Record<string, string | boolean | undefined>

function send(channel: string, payload: unknown) {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, payload)
}

function accountLabel(kind: SourceKind): string | undefined {
  const s = vault.get<Record<string, unknown>>(kind)
  return (s?.email ?? s?.username ?? s?.path) as string | undefined
}

function statuses() {
  const data = session.get()
  const kinds: SourceKind[] = ['google', 'microsoft', 'exchange', 'icloud', 'yahoo', 'apple', 'macmail', 'messages', 'calls', 'iphoneBackup']
  return kinds.map((kind) => ({
    kind,
    configured: data.demo ? !!data.meta[kind] : !!vault.get(kind),
    account: data.demo ? data.meta[kind]?.account : accountLabel(kind),
    ...data.meta[kind]
  }))
}

async function connect(kind: SourceKind, p: ConnectPayload): Promise<string> {
  switch (kind) {
    case 'google': {
      const { clientId, clientSecret } = p.clientJson ? parseClientJson(String(p.clientJson)) : { clientId: String(p.clientId ?? ''), clientSecret: String(p.clientSecret ?? '') }
      if (!clientId.endsWith('.apps.googleusercontent.com')) throw new Error('Client ID should end with .apps.googleusercontent.com')
      return `Connected as ${await googleSignIn(clientId, clientSecret)}`
    }
    case 'microsoft':
    case 'exchange': {
      if (kind === 'exchange' && p.mode === 'ews') {
        vault.set('exchange', { mode: 'ews', url: String(p.url), username: String(p.username), password: String(p.password) })
        break
      }
      const clientId = String(p.clientId ?? '').trim()
      if (!/^[0-9a-f-]{36}$/i.test(clientId)) throw new Error('Application (client) ID should be a GUID like 1234abcd-…')
      const who = await microsoftSignIn(kind, clientId, kind === 'exchange' ? 'organizations' : ((p.tenant as 'consumers' | 'common') ?? 'consumers'))
      return `Connected as ${who}`
    }
    case 'icloud':
    case 'yahoo':
      vault.set(kind, { username: String(p.username).trim(), password: String(p.password).replace(/\s/g, ''), scanMail: p.scanMail !== false })
      break
    case 'iphoneBackup':
      vault.set(kind, { path: String(p.path) })
      break
    default:
      vault.set(kind, { enabled: true })
  }
  try {
    return await getConnector(kind).test()
  } catch (err) {
    if (!['google', 'microsoft'].includes(kind)) vault.set(kind, undefined)
    throw err
  }
}

async function importSource(kind: SourceKind, historyYears: number) {
  const connector = getConnector(kind)
  const usage = new UsageAggregator()
  const ctx = {
    progress: (message: string, count?: number) => send('progress', { source: kind, message, count }),
    usage,
    since: Date.now() - historyYears * YEAR
  }
  try {
    const contacts = connector.fetchContacts ? await connector.fetchContacts(ctx) : undefined
    if (connector.scanUsage) await connector.scanUsage(ctx)
    session.setSource(kind, contacts, connector.scanUsage ? usage.index : undefined, {
      account: accountLabel(kind),
      contacts: contacts?.length,
      usageKeys: connector.scanUsage ? Object.keys(usage.index).length : undefined,
      importedAt: Date.now(),
      error: undefined
    })
  } catch (err) {
    session.setMeta(kind, { error: errorMessage(err) })
    throw err
  }
}

/** Wrap handlers so errors reach the renderer as { error } instead of noisy rejections. */
function handle<A extends unknown[], R>(channel: string, fn: (...args: A) => Promise<R> | R) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return { ok: true, value: await fn(...(args as A)) }
    } catch (err) {
      console.error(channel, err)
      return { ok: false, error: errorMessage(err) }
    }
  })
}

export function registerIpc() {
  handle('app:info', () => ({
    platform: process.platform,
    region: app.getLocaleCountryCode(),
    demo: session.get().demo,
    fda: process.platform === 'darwin' ? diskAccessStatus() : null,
    sources: statuses()
  }))
  handle('source:connect', (kind: SourceKind, payload: ConnectPayload) => connect(kind, payload))
  handle('source:disconnect', (kind: SourceKind) => {
    vault.set(kind, undefined)
    session.removeSource(kind)
  })
  handle('source:import', (kind: SourceKind, historyYears: number) => importSource(kind, historyYears))
  handle('recents:load', () => {
    if (!session.get().demo) session.setRecents(readRecents())
    return session.get().recents?.length ?? 0
  })
  handle('data:get', () => ({
    contacts: session.allContacts(),
    usage: session.mergedUsage(),
    recents: session.get().recents ?? [],
    demo: session.get().demo
  }))
  handle('demo:load', () => session.loadDemo())
  handle('session:reset', () => session.reset())
  handle('iphone:backups', () => listIphoneBackups())
  handle('shell:open', (url: string) => {
    const host = new URL(url).hostname
    if (!OPEN_ALLOW.some((h) => host === h || host.endsWith('.' + h))) throw new Error(`Refusing to open ${host}`)
    return shell.openExternal(url)
  })
  handle('shell:privacy', (pane: string) => shell.openExternal(PRIVACY_PANES[pane] ?? PRIVACY_PANES.fullDisk))
  handle('dialog:readJson', async () => {
    const res = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'OAuth client JSON', extensions: ['json'] }] })
    if (res.canceled || !res.filePaths[0]) return undefined
    const text = readFileSync(res.filePaths[0], 'utf8')
    parseClientJson(text) // validate before handing back
    return text
  })
  handle('export:save', async (content: string, defaultName: string) => {
    const ext = defaultName.split('.').pop()!
    const res = await dialog.showSaveDialog({ defaultPath: defaultName, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] })
    if (res.canceled || !res.filePath) return undefined
    writeFileSync(res.filePath, content, 'utf8')
    shell.showItemInFolder(res.filePath)
    return res.filePath
  })
  handle('push:execute', (plans: ChangePlan[], recentsRowIds: number[]) =>
    executePush(plans, recentsRowIds, (source, message) => send('progress', { source, message }))
  )
  handle('push:undo', (id: string) => undoPush(id, (source, message) => send('progress', { source, message })))
  handle('push:journals', () => listJournals())
  handle('push:revealBackups', () => shell.openPath(app.getPath('userData') + '/backups'))
}
