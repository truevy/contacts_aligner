import { PublicClientApplication, type ICachePlugin, type TokenCacheContext } from '@azure/msal-node'
import { shell } from 'electron'
import type { AlignedContact, Contact, SourceKind } from '@engine/types'
import { vault } from '../vault'
import { applySequentially, httpError, withRetry, type Connector } from './types'

// Microsoft Graph connector, used for Outlook.com (tenant "consumers") and for
// Microsoft 365 / Exchange Online work accounts (tenant "organizations").

const SCOPES = ['User.Read', 'Contacts.ReadWrite', 'Mail.ReadBasic']
const GRAPH = 'https://graph.microsoft.com/v1.0'
const MAX_MESSAGES = 6000

interface MsSecrets extends Record<string, unknown> {
  clientId: string
  tenant: 'consumers' | 'organizations' | 'common'
  cache?: string
  username?: string
}

function cachePlugin(key: SourceKind): ICachePlugin {
  return {
    async beforeCacheAccess(ctx: TokenCacheContext) {
      const cache = vault.get<MsSecrets>(key)?.cache
      if (cache) ctx.tokenCache.deserialize(cache)
    },
    async afterCacheAccess(ctx: TokenCacheContext) {
      if (ctx.cacheHasChanged) vault.patch(key, { cache: ctx.tokenCache.serialize() })
    }
  }
}

function pca(key: SourceKind, s: Pick<MsSecrets, 'clientId' | 'tenant'>) {
  return new PublicClientApplication({
    auth: { clientId: s.clientId, authority: `https://login.microsoftonline.com/${s.tenant}` },
    cache: { cachePlugin: cachePlugin(key) }
  })
}

export async function microsoftSignIn(key: SourceKind, clientId: string, tenant: MsSecrets['tenant']): Promise<string> {
  vault.set(key, { clientId, tenant })
  const app = pca(key, { clientId, tenant })
  const res = await app.acquireTokenInteractive({
    scopes: SCOPES,
    openBrowser: async (url) => {
      await shell.openExternal(url)
    },
    successTemplate: '<h2 style="font-family:system-ui">Signed in ✓ — you can close this tab and return to Contacts Aligner.</h2>',
    errorTemplate: '<h2 style="font-family:system-ui">Sign-in failed: {error}</h2>'
  })
  vault.patch(key, { username: res.account?.username })
  return res.account?.username ?? 'Microsoft account'
}

async function token(key: SourceKind): Promise<string> {
  const s = vault.get<MsSecrets>(key)
  if (!s) throw new Error('Microsoft account is not connected')
  const app = pca(key, s)
  const [account] = await app.getTokenCache().getAllAccounts()
  if (!account) throw new Error('Microsoft session expired — sign in again.')
  const res = await app.acquireTokenSilent({ account, scopes: SCOPES })
  return res.accessToken
}

async function graph<T>(key: SourceKind, pathOrUrl: string, init: RequestInit = {}): Promise<T> {
  return withRetry(async () => {
    const res = await fetch(pathOrUrl.startsWith('http') ? pathOrUrl : GRAPH + pathOrUrl, {
      ...init,
      headers: { Authorization: `Bearer ${await token(key)}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) }
    })
    if (!res.ok) throw httpError(res.status, await res.text())
    return (res.status === 204 ? undefined : await res.json()) as T
  })
}

async function* pages<T>(key: SourceKind, path: string): AsyncGenerator<T[]> {
  let url: string | undefined = path
  while (url) {
    const res: { value: T[]; '@odata.nextLink'?: string } = await graph(key, url)
    yield res.value
    url = res['@odata.nextLink']
  }
}

interface GraphContact {
  id: string
  changeKey?: string
  displayName?: string
  givenName?: string
  middleName?: string
  surname?: string
  nickName?: string
  companyName?: string
  jobTitle?: string
  emailAddresses?: Array<{ address?: string; name?: string }>
  businessPhones?: string[]
  homePhones?: string[]
  mobilePhone?: string | null
  birthday?: string | null
  personalNotes?: string
  homeAddress?: Record<string, string>
  businessAddress?: Record<string, string>
}

const fmtAddr = (a?: Record<string, string>) => (a ? [a.street, a.city, a.state, a.postalCode, a.countryOrRegion].filter(Boolean).join(', ') : '')

function toContact(key: SourceKind, g: GraphContact): Contact {
  const phones = [
    ...(g.mobilePhone ? [{ value: g.mobilePhone, label: 'mobile' }] : []),
    ...(g.businessPhones ?? []).map((value) => ({ value, label: 'work' })),
    ...(g.homePhones ?? []).map((value) => ({ value, label: 'home' }))
  ]
  const addresses = [
    ...(fmtAddr(g.homeAddress) ? [{ value: fmtAddr(g.homeAddress), label: 'home' }] : []),
    ...(fmtAddr(g.businessAddress) ? [{ value: fmtAddr(g.businessAddress), label: 'work' }] : [])
  ]
  return {
    uid: `${key}:${g.id}`,
    source: key,
    recordId: g.id,
    etag: g.changeKey,
    displayName: g.displayName || [g.givenName, g.surname].filter(Boolean).join(' ') || g.companyName || '',
    firstName: g.givenName || undefined,
    middleName: g.middleName || undefined,
    lastName: g.surname || undefined,
    nickname: g.nickName || undefined,
    organization: g.companyName || undefined,
    title: g.jobTitle || undefined,
    emails: (g.emailAddresses ?? []).filter((e) => e.address).map((e) => ({ value: e.address! })),
    phones,
    addresses,
    birthday: g.birthday?.slice(0, 10),
    notes: g.personalNotes || undefined
  }
}

/** Outlook contacts have fixed slots: 3 emails, 1 mobile, 2 business, 2 home phones. */
export function toGraph(a: AlignedContact): Partial<GraphContact> {
  const mobile: string[] = []
  const work: string[] = []
  const home: string[] = []
  for (const p of a.phones) {
    const l = p.label?.toLowerCase() ?? ''
    if (/work|business|main/.test(l)) work.push(p.value)
    else if (/home/.test(l)) home.push(p.value)
    else mobile.push(p.value)
  }
  // Spill extra mobiles into free slots rather than dropping them
  const [first, ...rest] = mobile
  for (const r of rest) (home.length < 2 ? home : work).push(r)
  return {
    displayName: a.displayName,
    givenName: a.firstName ?? '',
    middleName: a.middleName ?? '',
    surname: a.lastName ?? '',
    companyName: a.organization ?? '',
    jobTitle: a.title ?? '',
    emailAddresses: a.emails.slice(0, 3).map((e) => ({ address: e.value, name: a.displayName })),
    mobilePhone: first ?? null,
    businessPhones: work.slice(0, 2),
    homePhones: home.slice(0, 2)
  }
}

export function microsoftConnector(key: 'microsoft' | 'exchange'): Connector {
  const SELECT = 'id,changeKey,displayName,givenName,middleName,surname,nickName,companyName,jobTitle,emailAddresses,businessPhones,homePhones,mobilePhone,birthday,personalNotes,homeAddress,businessAddress'
  return {
    kind: key,
    async test() {
      const me = await graph<{ userPrincipalName?: string; mail?: string }>(key, '/me?$select=userPrincipalName,mail')
      return `Connected as ${me.mail ?? me.userPrincipalName}`
    },
    async fetchContacts(ctx) {
      const out: Contact[] = []
      for await (const page of pages<GraphContact>(key, `/me/contacts?$top=500&$select=${SELECT}`)) {
        out.push(...page.map((g) => toContact(key, g)))
        ctx.progress(`${key}: ${out.length} contacts`, out.length)
      }
      return out
    },
    async scanUsage(ctx) {
      const since = new Date(ctx.since).toISOString()
      let n = 0
      for await (const page of pages<{ toRecipients?: Array<{ emailAddress: { address: string } }>; ccRecipients?: Array<{ emailAddress: { address: string } }>; sentDateTime: string }>(
        key,
        `/me/mailFolders/sentitems/messages?$top=500&$select=toRecipients,ccRecipients,sentDateTime&$filter=sentDateTime ge ${since}&$orderby=sentDateTime desc`
      )) {
        for (const m of page) {
          const at = Date.parse(m.sentDateTime)
          for (const r of [...(m.toRecipients ?? []), ...(m.ccRecipients ?? [])]) ctx.usage.add(r.emailAddress.address, 'email', 'out', at, key)
        }
        n += page.length
        ctx.progress(`${key} sent: ${n} messages`, n)
        if (n >= MAX_MESSAGES) break
      }
      n = 0
      for await (const page of pages<{ from?: { emailAddress: { address: string } }; receivedDateTime: string }>(
        key,
        `/me/mailFolders/inbox/messages?$top=500&$select=from,receivedDateTime&$filter=receivedDateTime ge ${since}&$orderby=receivedDateTime desc`
      )) {
        for (const m of page) if (m.from) ctx.usage.add(m.from.emailAddress.address, 'email', 'in', Date.parse(m.receivedDateTime), key)
        n += page.length
        ctx.progress(`${key} inbox: ${n} messages`, n)
        if (n >= MAX_MESSAGES / 2) break
      }
    },
    async backup() {
      const all: GraphContact[] = []
      for await (const page of pages<GraphContact>(key, `/me/contacts?$top=500`)) all.push(...page)
      return { ext: 'json', data: JSON.stringify(all, null, 1) }
    },
    async apply(ops, ctx) {
      return applySequentially(ops, ctx, async (op) => {
        if (op.op === 'update') await graph(key, `/me/contacts/${op.recordId}`, { method: 'PATCH', body: JSON.stringify(toGraph(op.after)) })
        else if (op.op === 'delete') await graph(key, `/me/contacts/${op.recordId}`, { method: 'DELETE' })
        else {
          const created = await graph<GraphContact>(key, '/me/contacts', { method: 'POST', body: JSON.stringify(toGraph(op.after)) })
          return created.id
        }
      })
    }
  }
}
