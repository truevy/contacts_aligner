import type { SourceKind } from '@engine/types'
import { vault } from '../vault'
import type { Connector } from './types'
import { apple } from './apple'
import { cardDav, CARDDAV_SERVERS, type DavAccount } from './carddav'
import { imapUsage, IMAP_HOSTS } from './imap'
import { googleConnector } from './google'
import { microsoftConnector } from './microsoft'
import { ewsConnector, type EwsAccount } from './ews'
import { calls, iphoneBackup, macMail, messages } from './localMac'

export function getConnector(kind: SourceKind): Connector {
  switch (kind) {
    case 'google':
      return googleConnector
    case 'microsoft':
      return microsoftConnector('microsoft')
    case 'exchange': {
      const s = vault.get<Record<string, unknown>>('exchange')
      return s?.mode === 'ews' ? ewsConnector(() => vault.get<EwsAccount & Record<string, unknown>>('exchange')) : microsoftConnector('exchange')
    }
    case 'icloud':
    case 'yahoo': {
      const creds = () => vault.get<DavAccount & Record<string, unknown>>(kind)
      const dav = cardDav(kind, CARDDAV_SERVERS[kind]!, creds)
      const withMail = vault.get<Record<string, unknown>>(kind)?.scanMail !== false
      return { ...dav, ...(withMail ? imapUsage(kind, IMAP_HOSTS[kind]!, creds) : {}) }
    }
    case 'apple':
      return apple
    case 'macmail':
      return macMail
    case 'messages':
      return messages
    case 'calls':
      return calls
    case 'iphoneBackup': {
      const path = vault.get<{ path: string }>('iphoneBackup')?.path
      if (!path) throw new Error('Choose an iPhone backup first')
      return iphoneBackup(path)
    }
  }
}
