import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Credentials and cached contact data are encrypted with Electron safeStorage,
// whose key lives in the macOS Keychain. Nothing here is ever sent to the renderer.

function file(name: string) {
  const dir = app.getPath('userData')
  mkdirSync(dir, { recursive: true })
  return join(dir, name)
}

export function readEncrypted<T>(name: string, fallback: T): T {
  const path = file(name)
  if (!existsSync(path)) return fallback
  try {
    const buf = readFileSync(path)
    const text = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString('utf8')
    return JSON.parse(text) as T
  } catch (err) {
    console.error(`Could not read ${name}:`, err)
    return fallback
  }
}

export function writeEncrypted(name: string, value: unknown) {
  const text = JSON.stringify(value)
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Keychain encryption is not available; refusing to store secrets in plain text.')
  writeFileSync(file(name), safeStorage.encryptString(text), { mode: 0o600 })
}

export type Secrets = Record<string, Record<string, unknown> | undefined>

const SECRETS = 'accounts.bin'
let cache: Secrets | undefined

export const vault = {
  all(): Secrets {
    cache ??= readEncrypted<Secrets>(SECRETS, {})
    return cache
  },
  get<T extends Record<string, unknown>>(key: string): T | undefined {
    return this.all()[key] as T | undefined
  },
  set(key: string, value: Record<string, unknown> | undefined) {
    const all = this.all()
    if (value === undefined) delete all[key]
    else all[key] = value
    writeEncrypted(SECRETS, all)
  },
  patch(key: string, value: Record<string, unknown>) {
    this.set(key, { ...(this.get(key) ?? {}), ...value })
  }
}
