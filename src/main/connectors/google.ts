import { google, type people_v1 } from 'googleapis'
import { OAuth2Client, CodeChallengeMethod, type Credentials } from 'google-auth-library'
import type { AlignedContact, Contact } from '@engine/types'
import { vault } from '../vault'
import { loopbackAuthorize } from './oauthLoopback'
import { addressesIn, applySequentially, mapLimit, type Connector } from './types'

const SCOPES = [
  'https://www.googleapis.com/auth/contacts',
  // Metadata scope cannot read message bodies — only headers and labels.
  'https://www.googleapis.com/auth/gmail.metadata'
]
const PERSON_FIELDS = 'names,nicknames,emailAddresses,phoneNumbers,organizations,addresses,birthdays,biographies,metadata'
const MAX_SENT = 5000
const MAX_INBOX = 2500

interface GoogleSecrets extends Record<string, unknown> {
  clientId: string
  clientSecret: string
  tokens?: Credentials
  email?: string
}

/** Accepts the client_secret JSON downloaded from Google Cloud Console. */
export function parseClientJson(text: string): { clientId: string; clientSecret: string } {
  const j = JSON.parse(text)
  const inner = j.installed ?? j.web ?? j
  if (!inner.client_id || !inner.client_secret) throw new Error('That file does not look like a Google OAuth client JSON (missing client_id/client_secret).')
  if (j.web) throw new Error('This is a "Web application" client. Create a "Desktop app" OAuth client instead.')
  return { clientId: inner.client_id, clientSecret: inner.client_secret }
}

function auth(): OAuth2Client {
  const s = vault.get<GoogleSecrets>('google')
  if (!s?.tokens) throw new Error('Google is not connected')
  const client = new OAuth2Client({ clientId: s.clientId, clientSecret: s.clientSecret })
  client.setCredentials(s.tokens)
  client.on('tokens', (t) => vault.patch('google', { tokens: { ...s.tokens, ...t } }))
  return client
}

export async function googleSignIn(clientId: string, clientSecret: string): Promise<string> {
  const client = new OAuth2Client({ clientId, clientSecret })
  const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync()
  const { code, redirectUri } = await loopbackAuthorize((redirect_uri) =>
    client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: SCOPES,
      redirect_uri,
      code_challenge: codeChallenge,
      code_challenge_method: CodeChallengeMethod.S256
    })
  )
  const { tokens } = await client.getToken({ code, codeVerifier, redirect_uri: redirectUri })
  client.setCredentials(tokens)
  const profile = await google.gmail({ version: 'v1', auth: client }).users.getProfile({ userId: 'me' })
  vault.set('google', { clientId, clientSecret, tokens, email: profile.data.emailAddress ?? undefined })
  return profile.data.emailAddress ?? 'Google account'
}

function toContact(p: people_v1.Schema$Person): Contact {
  const name = p.names?.[0]
  const org = p.organizations?.[0]
  const b = p.birthdays?.[0]?.date
  const id = p.resourceName!
  return {
    uid: `google:${id}`,
    source: 'google',
    recordId: id,
    etag: p.etag ?? undefined,
    displayName: name?.displayName ?? org?.name ?? p.emailAddresses?.[0]?.value ?? '',
    firstName: name?.givenName ?? undefined,
    middleName: name?.middleName ?? undefined,
    lastName: name?.familyName ?? undefined,
    nickname: p.nicknames?.[0]?.value ?? undefined,
    organization: org?.name ?? undefined,
    title: org?.title ?? undefined,
    emails: (p.emailAddresses ?? []).filter((e) => e.value).map((e) => ({ value: e.value!, label: e.type ?? undefined })),
    phones: (p.phoneNumbers ?? []).filter((e) => e.value).map((e) => ({ value: e.value!, label: e.type ?? undefined })),
    addresses: (p.addresses ?? []).filter((a) => a.formattedValue).map((a) => ({ value: a.formattedValue!.replace(/\n/g, ', '), label: a.type ?? undefined })),
    birthday: b ? [b.year ?? '-', String(b.month).padStart(2, '0'), String(b.day).padStart(2, '0')].join('-') : undefined,
    notes: p.biographies?.[0]?.value ?? undefined,
    raw: JSON.stringify(p)
  }
}

function toPerson(a: AlignedContact, raw?: string): people_v1.Schema$Person {
  const prev = raw ? (JSON.parse(raw) as people_v1.Schema$Person) : {}
  const org = { ...(prev.organizations?.[0] ?? {}), name: a.organization, title: a.title }
  return {
    etag: prev.etag,
    names: [{ givenName: a.firstName, middleName: a.middleName, familyName: a.lastName, unstructuredName: a.displayName }],
    emailAddresses: a.emails.map((e) => ({ value: e.value, type: e.label })),
    phoneNumbers: a.phones.map((p) => ({ value: p.value, type: p.label })),
    organizations: a.organization || a.title ? [org, ...(prev.organizations?.slice(1) ?? [])] : []
  }
}

/** Strip server-owned fields so a backed-up person can be re-created. */
function restorable(p: people_v1.Schema$Person): people_v1.Schema$Person {
  const { resourceName, etag, metadata, memberships, ...rest } = p
  void resourceName, void etag, void metadata, void memberships
  const strip = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(strip) : v && typeof v === 'object'
      ? Object.fromEntries(Object.entries(v).filter(([k]) => k !== 'metadata').map(([k, x]) => [k, strip(x)]))
      : v
  return strip(rest) as people_v1.Schema$Person
}

export const googleConnector: Connector = {
  kind: 'google',
  async test() {
    const p = await google.gmail({ version: 'v1', auth: auth() }).users.getProfile({ userId: 'me' })
    return `Connected as ${p.data.emailAddress}`
  },
  async fetchContacts(ctx) {
    const people = google.people({ version: 'v1', auth: auth() })
    const out: Contact[] = []
    let pageToken: string | undefined
    do {
      const res = await people.people.connections.list({ resourceName: 'people/me', personFields: PERSON_FIELDS, pageSize: 1000, pageToken })
      for (const p of res.data.connections ?? []) out.push(toContact(p))
      pageToken = res.data.nextPageToken ?? undefined
      ctx.progress(`Google: ${out.length} contacts`, out.length)
    } while (pageToken)
    return out
  },
  async scanUsage(ctx) {
    const gmail = google.gmail({ version: 'v1', auth: auth() })
    const after = new Date(ctx.since).toISOString().slice(0, 10).replace(/-/g, '/')
    for (const [q, dir, max] of [[`in:sent after:${after}`, 'out', MAX_SENT], [`in:inbox after:${after}`, 'in', MAX_INBOX]] as const) {
      const ids: string[] = []
      let pageToken: string | undefined
      do {
        const res = await gmail.users.messages.list({ userId: 'me', q, maxResults: 500, pageToken })
        ids.push(...(res.data.messages ?? []).map((m) => m.id!))
        pageToken = res.data.nextPageToken ?? undefined
      } while (pageToken && ids.length < max)
      let done = 0
      await mapLimit(ids.slice(0, max), 8, async (id) => {
        const m = await gmail.users.messages.get({ userId: 'me', id, format: 'metadata', metadataHeaders: ['From', 'To', 'Cc'] })
        const headers = m.data.payload?.headers ?? []
        const h = (n: string) => headers.find((x) => x.name?.toLowerCase() === n)?.value
        const at = Number(m.data.internalDate ?? 0)
        const who = dir === 'out' ? [...addressesIn(h('to')), ...addressesIn(h('cc'))] : addressesIn(h('from'))
        for (const addr of who) ctx.usage.add(addr, 'email', dir, at, 'google')
        if (++done % 200 === 0) ctx.progress(`Gmail ${dir === 'out' ? 'sent' : 'inbox'}: ${done}/${Math.min(ids.length, max)}`, done)
      })
    }
  },
  async backup() {
    const people = google.people({ version: 'v1', auth: auth() })
    const all: people_v1.Schema$Person[] = []
    let pageToken: string | undefined
    do {
      const res = await people.people.connections.list({ resourceName: 'people/me', personFields: PERSON_FIELDS + ',urls,relations,events,userDefined,memberships', pageSize: 1000, pageToken })
      all.push(...(res.data.connections ?? []))
      pageToken = res.data.nextPageToken ?? undefined
    } while (pageToken)
    return { ext: 'json', data: JSON.stringify(all, null, 1) }
  },
  async apply(ops, ctx) {
    const people = google.people({ version: 'v1', auth: auth() })
    return applySequentially(ops, ctx, async (op) => {
      if (op.op === 'update') {
        // Fetch the current etag; Google rejects stale ones.
        const cur = await people.people.get({ resourceName: op.recordId, personFields: 'organizations,metadata' })
        const body = toPerson(op.after, op.before.raw)
        body.etag = cur.data.etag
        body.organizations = op.after.organization || op.after.title ? [{ ...(cur.data.organizations?.[0] ?? {}), name: op.after.organization, title: op.after.title }] : []
        await people.people.updateContact({ resourceName: op.recordId, updatePersonFields: 'names,emailAddresses,phoneNumbers,organizations', requestBody: body })
      } else if (op.op === 'delete') {
        await people.people.deleteContact({ resourceName: op.recordId })
      } else {
        const requestBody = op.restoreRaw ? restorable(JSON.parse(op.restoreRaw)) : toPerson(op.after)
        const res = await people.people.createContact({ requestBody })
        return res.data.resourceName ?? undefined
      }
    })
  }
}
