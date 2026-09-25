import { useEffect, useState } from 'react'
import { ExternalLink, FileText, LoaderCircle, RefreshCw, Settings2, ShieldCheck } from 'lucide-react'
import { api, type MacAccount } from '../lib/api'

export type GoogleMode = 'mac' | 'file' | 'oauth'

interface Props {
  mode: Exclude<GoogleMode, 'oauth'>
  busy?: string
  color: string
  attempt: (label: string, fn: () => Promise<string | void>) => Promise<void>
  historyYears: number
}

const TYPE_LABEL: Record<MacAccount['type'], string> = { cardDAV: 'Online account', exchange: 'Exchange', local: 'On My Mac', unassigned: 'Other' }

function Step({ n, color, title, children }: { n: number; color: string; title: string; children?: React.ReactNode }) {
  return (
    <li className="flex gap-3 text-sm">
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold text-white" style={{ background: `${color}55` }}>{n}</span>
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="text-ink-200">{title}</div>
        {children && <div className="mt-2">{children}</div>}
      </div>
    </li>
  )
}

/** Gmail history via a Google app password: optional in both simple modes. */
function MailHistory({ email, setEmail, pw, setPw }: { email: string; setEmail: (v: string) => void; pw: string; setPw: (v: string) => void }) {
  const [open, setOpen] = useState(!!pw)
  if (!open) {
    return (
      <div className="text-xs text-ink-400">
        If Gmail is set up in Mail.app, connect <b className="text-ink-200">Mail.app history</b> and you’re done.{' '}
        <button className="font-semibold text-indigo-300 hover:text-indigo-200" onClick={() => setOpen(true)}>Or use a Gmail app password</button>
      </div>
    )
  }
  return (
    <div className="space-y-2">
      <button className="flex items-center gap-1 text-xs font-semibold text-indigo-300 hover:text-indigo-200" onClick={() => api.open('https://myaccount.google.com/apppasswords')}>
        Create an app password (needs 2-Step Verification) <ExternalLink size={12} />
      </button>
      <input className="field" type="email" placeholder="you@gmail.com" value={email} onChange={(e) => setEmail(e.target.value)} spellCheck={false} />
      <input className="field" type="password" placeholder="16-character app password" value={pw} onChange={(e) => setPw(e.target.value)} />
      <div className="text-[11px] text-ink-400">Used only to read From/To/Cc/Date headers over IMAP. You can revoke it anytime.</div>
    </div>
  )
}

export function GoogleSimpleSetup({ mode, busy, color, attempt, historyYears }: Props) {
  const [accounts, setAccounts] = useState<MacAccount[]>()
  const [loadError, setLoadError] = useState<string>()
  const [selected, setSelected] = useState<string[]>([])
  const [filePath, setFilePath] = useState<string>()
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')

  const loadAccounts = async () => {
    setLoadError(undefined)
    try {
      const list = (await api.macAccounts()).filter((a) => a.type !== 'unassigned')
      setAccounts(list)
      // Preselect anything that looks like Google; the user can change it.
      setSelected((cur) => (cur.length ? cur : list.filter((a) => /google|gmail/i.test(a.name)).map((a) => a.id)))
    } catch (err) {
      setLoadError((err as Error).message)
    }
  }

  useEffect(() => {
    if (mode === 'mac') loadAccounts()
    // Re-check when the user comes back from System Settings.
    const onFocus = () => mode === 'mac' && loadAccounts()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [mode])

  const mailOk = !pw || /\S+@\S+/.test(email)
  const ready = (mode === 'mac' ? selected.length > 0 : !!filePath) && mailOk

  const connect = () =>
    attempt('Connecting…', async () => {
      const payload =
        mode === 'mac'
          ? { mode, containerIds: selected.join(','), label: accounts?.filter((a) => selected.includes(a.id)).map((a) => a.name).join(', ') }
          : { mode, filePath }
      const res = await api.connect('google', { ...payload, email, appPassword: pw })
      await api.importSource('google', historyYears)
      return res
    })

  return (
    <div className="space-y-5">
      {mode === 'mac' ? (
        <ol className="space-y-4">
          <Step n={1} color={color} title="Add your Google account to this Mac: System Settings → Internet Accounts → Google. Sign in and turn on Contacts (and Mail, for Gmail history).">
            <button className="btn btn-ghost py-1.5 text-xs" onClick={() => api.privacy('internetAccounts')}>
              <Settings2 size={14} /> Open Internet Accounts
            </button>
          </Step>
          <Step n={2} color={color} title="Choose which account is your Google account:">
            {loadError ? (
              <div className="rounded-lg bg-red-400/10 p-2 text-xs text-red-200">{loadError}</div>
            ) : !accounts ? (
              <div className="flex items-center gap-2 text-xs text-ink-400"><LoaderCircle size={14} className="animate-spin" /> Looking for accounts…</div>
            ) : (
              <div className="space-y-1.5">
                {accounts.map((a) => {
                  const on = selected.includes(a.id)
                  return (
                    <button key={a.id} onClick={() => setSelected((s) => (on ? s.filter((x) => x !== a.id) : [...s, a.id]))} className={`flex w-full items-center gap-3 rounded-xl border p-2.5 text-left text-sm transition ${on ? 'bg-white/[.06]' : 'border-white/10 bg-black/20'}`} style={on ? { borderColor: `${color}99` } : undefined}>
                      <span className={`grid h-4 w-4 place-items-center rounded border text-[10px] ${on ? 'border-transparent text-white' : 'border-white/25'}`} style={on ? { background: color } : undefined}>{on && '✓'}</span>
                      <span className="flex-1 truncate font-medium text-white">{a.name}</span>
                      <span className="text-[11px] text-ink-400">{TYPE_LABEL[a.type]} · {a.count}</span>
                    </button>
                  )
                })}
                {!accounts.some((a) => /google|gmail/i.test(a.name)) && (
                  <div className="text-[11px] text-amber-200/80">No account named Google yet. Add it in step 1; this list refreshes when you come back.</div>
                )}
              </div>
            )}
            <button className="mt-2 flex items-center gap-1 text-[11px] text-ink-400 hover:text-ink-200" onClick={loadAccounts}><RefreshCw size={11} /> Refresh</button>
          </Step>
          <Step n={3} color={color} title="Gmail history (optional)">
            <MailHistory email={email} setEmail={setEmail} pw={pw} setPw={setPw} />
          </Step>
        </ol>
      ) : (
        <ol className="space-y-4">
          <Step n={1} color={color} title="Open Google Contacts, click Export, and choose vCard.">
            <button className="btn btn-ghost py-1.5 text-xs" onClick={() => api.open('https://contacts.google.com/')}>
              Open Google Contacts <ExternalLink size={13} />
            </button>
          </Step>
          <Step n={2} color={color} title="Choose the downloaded contacts.vcf:">
            <button className="btn btn-ghost w-full justify-center" onClick={async () => setFilePath((await api.pickContactsFile()) ?? filePath)}>
              <FileText size={16} /> {filePath ? filePath.split('/').pop() : 'Choose file…'}
            </button>
          </Step>
          <Step n={3} color={color} title="Gmail history (optional)">
            <MailHistory email={email} setEmail={setEmail} pw={pw} setPw={setPw} />
          </Step>
          <div className="rounded-xl bg-white/[.03] p-3 text-[11px] text-ink-400">
            A file is read-only. To update Google afterwards, export a <b className="text-ink-200">Google CSV</b> on the Destination step and import it at contacts.google.com.
          </div>
        </ol>
      )}

      <button className="btn btn-primary w-full justify-center py-2.5" disabled={!!busy || !ready} onClick={connect}>
        {busy ? <LoaderCircle size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
        {busy ?? 'Connect & import'}
      </button>
    </div>
  )
}
