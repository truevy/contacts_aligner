import { XMLParser } from 'fast-xml-parser'
import type { AlignedContact, Contact } from '@engine/types'
import { applySequentially, httpError, withRetry, type Connector, type Ctx } from './types'

// On-premises Exchange via EWS SOAP with Basic auth over HTTPS.
// (Exchange Online should use the Microsoft Graph connector instead.)

export interface EwsAccount {
  url: string
  username: string
  password: string
}

// EWS responses are loosely typed XML trees.
type X = any

const parser = new XMLParser({
  removeNSPrefix: true,
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  isArray: (name) => ['Entry', 'Contact', 'Message', 'Mailbox', 'GetItemResponseMessage', 'ItemId', 'UpdateItemResponseMessage', 'DeleteItemResponseMessage', 'CreateItemResponseMessage'].includes(name)
})

const esc = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!)
const text = (v: unknown): string | undefined => (v == null ? undefined : typeof v === 'object' ? (v as { '#text'?: string })['#text'] : String(v))

async function soap(acct: EwsAccount, body: string): Promise<X> {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types" xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages">
<soap:Header><t:RequestServerVersion Version="Exchange2013"/></soap:Header><soap:Body>${body}</soap:Body></soap:Envelope>`
  return withRetry(async () => {
    const res = await fetch(acct.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        Authorization: 'Basic ' + Buffer.from(`${acct.username}:${acct.password}`).toString('base64')
      },
      body: xml
    })
    const txt = await res.text()
    if (res.status === 401) throw new Error('Exchange rejected the credentials (401). Basic auth may be disabled on this server.')
    if (!res.ok) throw httpError(res.status, txt)
    return parser.parse(txt).Envelope.Body
  })
}

function checkResponses(msgs: Array<Record<string, unknown>>) {
  for (const m of msgs) if (m['@_ResponseClass'] === 'Error') throw new Error(String(m.MessageText ?? m.ResponseCode))
}

async function findIds(acct: EwsAccount, folder: string, restriction = '', extraProps = ''): Promise<Array<{ id: string; changeKey: string; item: X }>> {
  const out: Array<{ id: string; changeKey: string; item: X }> = []
  for (let offset = 0; ; ) {
    const body = await soap(
      acct,
      `<m:FindItem Traversal="Shallow"><m:ItemShape><t:BaseShape>IdOnly</t:BaseShape>${extraProps}</m:ItemShape>
       <m:IndexedPageItemView MaxEntriesReturned="500" Offset="${offset}" BasePoint="Beginning"/>${restriction}
       <m:ParentFolderIds><t:DistinguishedFolderId Id="${folder}"/></m:ParentFolderIds></m:FindItem>`
    )
    const msg = body.FindItemResponse.ResponseMessages.FindItemResponseMessage
    checkResponses([msg])
    const root = msg.RootFolder
    const items = [...(root.Items?.Contact ?? []), ...(root.Items?.Message ?? [])]
    for (const it of items) {
      const idNode = Array.isArray(it.ItemId) ? it.ItemId[0] : it.ItemId
      out.push({ id: idNode['@_Id'], changeKey: idNode['@_ChangeKey'], item: it })
    }
    if (root['@_IncludesLastItemInRange'] === 'true' || !items.length) break
    offset = Number(root['@_IndexedPagingOffset'])
  }
  return out
}

async function getItems(acct: EwsAccount, ids: string[], shape: string): Promise<X[]> {
  const out = []
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100).map((id) => `<t:ItemId Id="${esc(id)}"/>`).join('')
    const body = await soap(acct, `<m:GetItem><m:ItemShape>${shape}</m:ItemShape><m:ItemIds>${batch}</m:ItemIds></m:GetItem>`)
    for (const m of body.GetItemResponse.ResponseMessages.GetItemResponseMessage) {
      if (m['@_ResponseClass'] === 'Error') continue
      out.push(...(m.Items.Contact ?? []), ...(m.Items.Message ?? []))
    }
  }
  return out
}

const PHONE_LABELS: Record<string, string> = {
  MobilePhone: 'mobile', BusinessPhone: 'work', BusinessPhone2: 'work', HomePhone: 'home', HomePhone2: 'home',
  OtherTelephone: 'other', CarPhone: 'car', PrimaryPhone: 'main', CompanyMainPhone: 'work'
}

function entries(node: X): Array<{ key: string; value: string }> {
  return (node?.Entry ?? []).map((e: Record<string, unknown>) => ({ key: String(e['@_Key']), value: text(e) ?? '' })).filter((e: { value: string }) => e.value)
}

function toContact(c: X): Contact {
  const idNode = Array.isArray(c.ItemId) ? c.ItemId[0] : c.ItemId
  const id = idNode['@_Id']
  return {
    uid: `exchange:${id}`,
    source: 'exchange',
    recordId: id,
    etag: idNode['@_ChangeKey'],
    displayName: text(c.DisplayName) ?? [text(c.GivenName), text(c.Surname)].filter(Boolean).join(' '),
    firstName: text(c.GivenName),
    middleName: text(c.MiddleName),
    lastName: text(c.Surname),
    nickname: text(c.Nickname),
    organization: text(c.CompanyName),
    title: text(c.JobTitle),
    emails: entries(c.EmailAddresses).filter((e) => e.value.includes('@')).map((e) => ({ value: e.value.replace(/^smtp:/i, '') })),
    phones: entries(c.PhoneNumbers).map((e) => ({ value: e.value, label: PHONE_LABELS[e.key] ?? 'other' })),
    addresses: [],
    birthday: text(c.Birthday)?.slice(0, 10)
  }
}

function phoneSlots(a: AlignedContact): Record<string, string | undefined> {
  const slots: Record<string, string | undefined> = { MobilePhone: undefined, BusinessPhone: undefined, BusinessPhone2: undefined, HomePhone: undefined, HomePhone2: undefined, OtherTelephone: undefined }
  const put = (prefs: string[], v: string) => {
    const free = [...prefs, 'OtherTelephone', 'HomePhone2', 'BusinessPhone2'].find((k) => !slots[k])
    if (free) slots[free] = v
  }
  for (const p of a.phones) {
    const l = p.label?.toLowerCase() ?? ''
    put(/work|business|main/.test(l) ? ['BusinessPhone', 'BusinessPhone2'] : /home/.test(l) ? ['HomePhone', 'HomePhone2'] : ['MobilePhone'], p.value)
  }
  return slots
}

function updateXml(a: AlignedContact): string {
  const simple: Array<[string, string | undefined]> = [
    ['DisplayName', a.displayName], ['GivenName', a.firstName], ['MiddleName', a.middleName],
    ['CompanyName', a.organization], ['JobTitle', a.title], ['Surname', a.lastName]
  ]
  const parts = simple.map(([f, v]) =>
    v ? `<t:SetItemField><t:FieldURI FieldURI="contacts:${f}"/><t:Contact><t:${f}>${esc(v)}</t:${f}></t:Contact></t:SetItemField>`
      : `<t:DeleteItemField><t:FieldURI FieldURI="contacts:${f}"/></t:DeleteItemField>`
  )
  for (let i = 1; i <= 3; i++) {
    const e = a.emails[i - 1]?.value
    const idx = `<t:IndexedFieldURI FieldURI="contacts:EmailAddress" FieldIndex="EmailAddress${i}"/>`
    parts.push(e ? `<t:SetItemField>${idx}<t:Contact><t:EmailAddresses><t:Entry Key="EmailAddress${i}">${esc(e)}</t:Entry></t:EmailAddresses></t:Contact></t:SetItemField>` : `<t:DeleteItemField>${idx}</t:DeleteItemField>`)
  }
  for (const [key, v] of Object.entries(phoneSlots(a))) {
    const idx = `<t:IndexedFieldURI FieldURI="contacts:PhoneNumber" FieldIndex="${key}"/>`
    parts.push(v ? `<t:SetItemField>${idx}<t:Contact><t:PhoneNumbers><t:Entry Key="${key}">${esc(v)}</t:Entry></t:PhoneNumbers></t:Contact></t:SetItemField>` : `<t:DeleteItemField>${idx}</t:DeleteItemField>`)
  }
  return parts.join('')
}

function createXml(a: AlignedContact): string {
  // EWS requires schema order: DisplayName, GivenName, MiddleName, CompanyName, EmailAddresses, PhoneNumbers, JobTitle, Surname
  const el = (n: string, v?: string) => (v ? `<t:${n}>${esc(v)}</t:${n}>` : '')
  const emails = a.emails.slice(0, 3).map((e, i) => `<t:Entry Key="EmailAddress${i + 1}">${esc(e.value)}</t:Entry>`).join('')
  const phones = Object.entries(phoneSlots(a)).filter(([, v]) => v).map(([k, v]) => `<t:Entry Key="${k}">${esc(v!)}</t:Entry>`).join('')
  return `<t:Contact>${el('DisplayName', a.displayName)}${el('GivenName', a.firstName)}${el('MiddleName', a.middleName)}${el('CompanyName', a.organization)}${emails ? `<t:EmailAddresses>${emails}</t:EmailAddresses>` : ''}${phones ? `<t:PhoneNumbers>${phones}</t:PhoneNumbers>` : ''}${el('JobTitle', a.title)}${el('Surname', a.lastName)}</t:Contact>`
}

const mailboxAddr = (m: X): string | undefined => text(m?.EmailAddress)

export function ewsConnector(acct: () => EwsAccount | undefined): Connector {
  const need = () => {
    const a = acct()
    if (!a) throw new Error('Exchange is not connected')
    return a
  }
  return {
    kind: 'exchange',
    async test() {
      const ids = await findIds(need(), 'contacts')
      return `Connected — ${ids.length} contacts`
    },
    async fetchContacts(ctx: Ctx) {
      const a = need()
      const ids = await findIds(a, 'contacts')
      ctx.progress(`Exchange: loading ${ids.length} contacts…`)
      const items = await getItems(a, ids.map((i) => i.id), '<t:BaseShape>AllProperties</t:BaseShape>')
      return items.map(toContact)
    },
    async scanUsage(ctx: Ctx) {
      const a = need()
      const since = new Date(ctx.since).toISOString()
      const restrict = (field: string) =>
        `<m:Restriction><t:IsGreaterThan><t:FieldURI FieldURI="item:${field}"/><t:FieldURIOrConstant><t:Constant Value="${since}"/></t:FieldURIOrConstant></t:IsGreaterThan></m:Restriction>`
      const sent = (await findIds(a, 'sentitems', restrict('DateTimeSent'))).slice(-5000)
      ctx.progress(`Exchange: reading ${sent.length} sent message headers…`)
      const msgs = await getItems(a, sent.map((s) => s.id), `<t:BaseShape>IdOnly</t:BaseShape><t:AdditionalProperties><t:FieldURI FieldURI="item:DateTimeSent"/><t:FieldURI FieldURI="message:ToRecipients"/><t:FieldURI FieldURI="message:CcRecipients"/></t:AdditionalProperties>`)
      for (const m of msgs) {
        const at = Date.parse(text(m.DateTimeSent) ?? '')
        for (const r of [...(m.ToRecipients?.Mailbox ?? []), ...(m.CcRecipients?.Mailbox ?? [])]) {
          const addr = mailboxAddr(r)
          if (addr) ctx.usage.add(addr, 'email', 'out', at, 'exchange')
        }
      }
      const inbox = await findIds(a, 'inbox', restrict('DateTimeReceived'), `<t:AdditionalProperties><t:FieldURI FieldURI="message:From"/><t:FieldURI FieldURI="item:DateTimeReceived"/></t:AdditionalProperties>`)
      for (const { item } of inbox) {
        const addr = mailboxAddr(item.From?.Mailbox?.[0])
        if (addr) ctx.usage.add(addr, 'email', 'in', Date.parse(text(item.DateTimeReceived) ?? ''), 'exchange')
      }
    },
    async backup() {
      const a = need()
      const ids = await findIds(a, 'contacts')
      const items = await getItems(a, ids.map((i) => i.id), '<t:BaseShape>AllProperties</t:BaseShape>')
      return { ext: 'json', data: JSON.stringify(items, null, 1) }
    },
    async apply(ops, ctx) {
      const a = need()
      return applySequentially(ops, ctx, async (op) => {
        if (op.op === 'update') {
          const body = await soap(a, `<m:UpdateItem ConflictResolution="AutoResolve" MessageDisposition="SaveOnly"><m:ItemChanges><t:ItemChange><t:ItemId Id="${esc(op.recordId)}" ChangeKey="${esc(op.etag ?? '')}"/><t:Updates>${updateXml(op.after)}</t:Updates></t:ItemChange></m:ItemChanges></m:UpdateItem>`)
          checkResponses(body.UpdateItemResponse.ResponseMessages.UpdateItemResponseMessage)
        } else if (op.op === 'delete') {
          // Moved to Deleted Items rather than purged, so it stays recoverable from Outlook.
          const body = await soap(a, `<m:DeleteItem DeleteType="MoveToDeletedItems"><m:ItemIds><t:ItemId Id="${esc(op.recordId)}"/></m:ItemIds></m:DeleteItem>`)
          checkResponses(body.DeleteItemResponse.ResponseMessages.DeleteItemResponseMessage)
        } else {
          const body = await soap(a, `<m:CreateItem><m:SavedItemFolderId><t:DistinguishedFolderId Id="contacts"/></m:SavedItemFolderId><m:Items>${createXml(op.after)}</m:Items></m:CreateItem>`)
          const msgs = body.CreateItemResponse.ResponseMessages.CreateItemResponseMessage
          checkResponses(msgs)
          const idNode = msgs[0].Items.Contact[0].ItemId
          return (Array.isArray(idNode) ? idNode[0] : idNode)['@_Id']
        }
      })
    }
  }
}
