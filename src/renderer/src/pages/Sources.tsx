import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useMemo, useState } from 'react'
import {
  ArrowRight, Check, ChevronRight, ExternalLink, FileJson, FolderOpen, HardDrive, KeyRound, LoaderCircle,
  RefreshCw, ShieldCheck, Trash2, TriangleAlert
} from 'lucide-react'
import type { SourceKind } from '@engine/types'
import { useStore } from '../lib/store'
import { api, type IphoneBackup, type SourceStatus } from '../lib/api'
import { SOURCES, SOURCE_BY_KIND, type SourceMeta } from '../lib/sources'
import { AnimatedNumber, Card, SourceIcon, StatusRing, Toggle } from '../components/ui'
import { GoogleSimpleSetup, type GoogleMode } from '../components/GoogleSetup'

type Busy = Partial<Record<SourceKind, string>>

export function Sources() {
  const { info, refreshInfo, loadData, go, historyYears, setHistoryYears } = useStore()
  const [selected, setSelected] = useState<SourceKind>('google')
  const [busy, setBusy] = useState<Busy>({})
  const isMac = info?.platform === 'darwin'
  const visible = SOURCES.filter((s) => isMac || !s.macOnly)

  useEffect(
    () =>
      api.onProgress((p) => {
        if (p.source in SOURCE_BY_KIND) setBusy((b) => (b[p.source as SourceKind] ? { ...b, [p.source]: p.message } : b))
      }),
    []
  )

  const status = (k: SourceKind) => info?.sources.find((s) => s.kind === k)
  const totalContacts = info?.sources.reduce((n, s) => n + (s.contacts ?? 0), 0) ?? 0
  const usageSources = info?.sources.filter((s) => s.usageKeys).length ?? 0

  const next = () => {
    const i = visible.findIndex((s) => s.kind === selected)
    setSelected(visible[(i + 1) % visible.length].kind)
  }

  const run = async (kind: SourceKind, label: string, fn: () => Promise<unknown>) => {
    setBusy((b) => ({ ...b, [kind]: label }))
    try {
      await fn()
    } finally {
      setBusy((b) => ({ ...b, [kind]: undefined }))
      await refreshInfo()
    }
  }

  const proceed = async () => {
    if (isMac && !info?.demo && status('macmail')?.configured && info?.fda?.recents === 'ok') {
      await api.loadRecents().catch(() => undefined)
    }
    await loadData()
    go('summary')
  }

  return (
    <div className="mx-auto flex max-w-7xl gap-6 px-8 py-8">
      <div className="min-w-0 flex-1">
        <div className="mb-6 flex items-end justify-between">
          <div>
            <h2 className="font-display text-3xl font-bold text-white">Where do your contacts live?</h2>
            <p className="mt-1 text-ink-400">Connect as many as you like. Each one is optional, and more history means better suggestions.</p>
          </div>
          <label className="flex items-center gap-2 text-xs text-ink-400">
            History to scan
            <select className="field w-auto py-1" value={historyYears} onChange={(e) => setHistoryYears(Number(e.target.value))}>
              {[1, 3, 5, 10, 20].map((y) => (
                <option key={y} value={y}>{y} year{y > 1 ? 's' : ''}</option>
              ))}
            </select>
          </label>
        </div>

        {info?.demo && (
          <Card className="mb-5 flex items-center justify-between border-fuchsia-400/30 px-5 py-3">
            <div className="text-sm"><span className="font-semibold text-fuchsia-300">Demo mode.</span> <span className="text-ink-300">These are synthetic contacts, so any push only changes demo data.</span></div>
            <button className="btn btn-ghost py-1 text-xs" onClick={async () => { await api.reset(); await refreshInfo(); await loadData() }}>Leave demo</button>
          </Card>
        )}

        {isMac && !info?.demo && info?.fda && Object.values(info.fda).includes('denied') && <FdaBanner />}

        {(['contacts', 'usage'] as const).map((group) => (
          <div key={group} className="mb-8">
            <div className="mb-3 text-xs font-semibold uppercase tracking-widest text-ink-400">
              {group === 'contacts' ? 'Contact sources' : 'Usage history, which shows what’s current'}
            </div>
            <div className="grid grid-cols-2 gap-3 2xl:grid-cols-3">
              {visible.filter((s) => s.group === group).map((s, i) => (
                <SourceTile key={s.kind} meta={s} status={status(s.kind)} busy={busy[s.kind]} selected={selected === s.kind} index={i} onClick={() => setSelected(s.kind)} />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="sticky top-8 flex h-[calc(100vh-9rem)] w-[420px] shrink-0 flex-col">
        <AnimatePresence mode="wait">
          <motion.div key={selected} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.2 }} className="min-h-0 flex-1">
            <SetupPanel meta={SOURCE_BY_KIND[selected]} status={status(selected)} busy={busy[selected]} run={run} demo={!!info?.demo} historyYears={historyYears} onNext={next} />
          </motion.div>
        </AnimatePresence>
        <Card className="mt-4 flex items-center justify-between px-5 py-4">
          <div>
            <div className="text-2xl font-bold text-white"><AnimatedNumber value={totalContacts} /> contacts</div>
            <div className="text-xs text-ink-400">{usageSources} usage source{usageSources === 1 ? '' : 's'} scanned</div>
          </div>
          <button className="btn btn-primary" disabled={!totalContacts} onClick={proceed}>
            Summary <ArrowRight size={16} />
          </button>
        </Card>
      </div>
    </div>
  )
}

function FdaBanner() {
  return (
    <Card className="mb-6 flex items-center gap-4 border-amber-400/30 px-5 py-4">
      <HardDrive className="shrink-0 text-amber-300" />
      <div className="flex-1 text-sm">
        <div className="font-semibold text-amber-200">Full Disk Access unlocks Mail, Messages and call history</div>
        <div className="text-ink-300">
          In System Settings → Privacy &amp; Security → Full Disk Access, turn on Contacts Aligner (or Electron / your terminal while developing). This page re-checks when you come back.
        </div>
      </div>
      <button className="btn btn-ghost shrink-0" onClick={() => api.privacy('fullDisk')}>Open Settings</button>
    </Card>
  )
}

function tileState(status: SourceStatus | undefined, busy: string | undefined) {
  if (busy) return 'busy' as const
  if (status?.error) return 'error' as const
  if (status?.importedAt) return 'done' as const
  return 'idle' as const
}

function SourceTile({ meta, status, busy, selected, index, onClick }: { meta: SourceMeta; status?: SourceStatus; busy?: string; selected: boolean; index: number; onClick: () => void }) {
  const state = tileState(status, busy)
  return (
    <motion.button
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04 }}
      onClick={onClick}
      className={`glass group relative flex items-center gap-4 rounded-2xl p-4 text-left transition ${selected ? 'ring-2' : 'hover:bg-white/5'}`}
      style={selected ? { boxShadow: `0 0 0 2px ${meta.color}88, 0 12px 40px -12px ${meta.color}66` } : undefined}
    >
      <StatusRing state={state} color={meta.color}>
        <SourceIcon kind={meta.kind} size={40} />
      </StatusRing>
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold text-white">{meta.name}</div>
        <div className="truncate text-xs text-ink-400">
          {busy ? busy : status?.error ? <span className="text-red-300">{status.error}</span> : status?.importedAt ? (
            <span className="text-emerald-300">
              {status.contacts != null && `${status.contacts.toLocaleString()} contacts`}
              {status.contacts != null && status.usageKeys ? ' · ' : ''}
              {status.usageKeys ? `${status.usageKeys.toLocaleString()} identifiers` : ''}
            </span>
          ) : status?.configured ? 'Connected, not imported yet' : meta.gives.join(' · ')}
        </div>
      </div>
      <ChevronRight size={16} className="text-ink-400 opacity-0 transition group-hover:opacity-100" />
    </motion.button>
  )
}

interface PanelProps {
  meta: SourceMeta
  status?: SourceStatus
  busy?: string
  demo: boolean
  historyYears: number
  run: (kind: SourceKind, label: string, fn: () => Promise<unknown>) => Promise<void>
  onNext: () => void
}

function SetupPanel({ meta, status, busy, run, demo, historyYears, onNext }: PanelProps) {
  const [values, setValues] = useState<Record<string, string | boolean>>({})
  const [message, setMessage] = useState<{ ok: boolean; text: string }>()
  const [exchangeMode, setExchangeMode] = useState<'graph' | 'ews'>('graph')
  const [tenant, setTenant] = useState<'consumers' | 'common'>('consumers')
  const [clientJson, setClientJson] = useState<string>()
  const [backups, setBackups] = useState<IphoneBackup[]>()
  const isMac = useStore((s) => s.info?.platform === 'darwin')
  const [googleMode, setGoogleMode] = useState<GoogleMode>(isMac ? 'mac' : 'file')

  useEffect(() => {
    if (meta.kind === 'iphoneBackup') api.iphoneBackups().then(setBackups).catch(() => setBackups([]))
  }, [meta.kind])

  const attempt = async (label: string, fn: () => Promise<string | void>) => {
    setMessage(undefined)
    await run(meta.kind, label, async () => {
      try {
        const res = await fn()
        setMessage({ ok: true, text: res || 'Done' })
      } catch (err) {
        setMessage({ ok: false, text: (err as Error).message.replace(/^Error invoking remote method '[^']+': /, '') })
      }
    })
  }

  const connect = () => {
    const payload: Record<string, unknown> = { ...values }
    if (meta.kind === 'google' && clientJson) payload.clientJson = clientJson
    if (meta.kind === 'microsoft') payload.tenant = tenant
    if (meta.kind === 'exchange') payload.mode = exchangeMode
    return attempt(meta.auth.startsWith('oauth') || (meta.kind === 'exchange' && exchangeMode === 'graph') ? 'Waiting for browser sign-in…' : 'Connecting…', async () => {
      const res = await api.connect(meta.kind, payload)
      // Import straight away: one click from credentials to data.
      await api.importSource(meta.kind, historyYears)
      return res
    })
  }

  const fields = meta.kind === 'exchange'
    ? exchangeMode === 'graph'
      ? [{ key: 'clientId', label: 'Application (client) ID', type: 'text' as const, placeholder: '00000000-0000-0000-0000-000000000000' }]
      : [
          { key: 'url', label: 'EWS URL', type: 'url' as const, placeholder: 'https://mail.company.com/EWS/Exchange.asmx' },
          { key: 'username', label: 'Username', type: 'text' as const, placeholder: 'DOMAIN\\user or user@company.com' },
          { key: 'password', label: 'Password', type: 'password' as const }
        ]
    : meta.fields ?? []

  const ready = useMemo(() => {
    if (meta.kind === 'google') return !!clientJson || (!!values.clientId && !!values.clientSecret)
    if (meta.kind === 'iphoneBackup') return !!values.path
    return fields.filter((f) => f.type !== 'checkbox').every((f) => String(values[f.key] ?? '').trim())
  }, [meta.kind, clientJson, values, fields])

  return (
    <Card className="glass-strong flex h-full flex-col overflow-hidden">
      <div className="flex items-center gap-4 border-b border-white/5 p-5" style={{ background: `linear-gradient(135deg, ${meta.color}22, transparent)` }}>
        <SourceIcon kind={meta.kind} size={48} />
        <div className="min-w-0">
          <div className="text-lg font-bold text-white">{meta.name}</div>
          <div className="text-xs text-ink-300">{meta.tagline}</div>
        </div>
      </div>

      <div className="scroll-thin flex-1 space-y-5 overflow-y-auto p-5">
        {status?.configured && (
          <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/5 p-3 text-sm">
            <div className="flex items-center gap-2 font-semibold text-emerald-300"><Check size={16} /> {status.account ?? 'Connected'}</div>
            {status.importedAt && <div className="mt-1 text-xs text-ink-400">Imported {new Date(status.importedAt).toLocaleString()}</div>}
            {!demo && (
              <div className="mt-3 flex gap-2">
                <button className="btn btn-ghost py-1 text-xs" disabled={!!busy} onClick={() => attempt('Importing…', () => api.importSource(meta.kind, historyYears).then(() => 'Imported'))}>
                  <RefreshCw size={13} /> Re-import
                </button>
                <button className="btn btn-ghost py-1 text-xs" disabled={!!busy} onClick={() => attempt('Disconnecting…', () => api.disconnect(meta.kind).then(() => 'Disconnected and credentials removed'))}>
                  <Trash2 size={13} /> Disconnect
                </button>
              </div>
            )}
          </div>
        )}

        {!demo && meta.kind === 'google' && (
          <div className="flex rounded-xl bg-black/20 p-1 text-xs font-semibold">
            {(isMac ? (['mac', 'file', 'oauth'] as const) : (['file', 'oauth'] as const)).map((m) => (
              <button key={m} onClick={() => setGoogleMode(m)} className={`flex-1 rounded-lg py-1.5 ${googleMode === m ? 'bg-white/10 text-white' : 'text-ink-400'}`}>
                {m === 'mac' ? 'This Mac (easiest)' : m === 'file' ? 'Contacts file' : 'Advanced'}
              </button>
            ))}
          </div>
        )}

        {!demo && meta.kind === 'google' && googleMode !== 'oauth' ? (
          <GoogleSimpleSetup key={googleMode} mode={googleMode} busy={busy} color={meta.color} attempt={attempt} historyYears={historyYears} />
        ) : !demo && (
          <>
            {meta.kind === 'google' && (
              <div className="text-xs text-ink-400">For direct API access with your own Google Cloud OAuth client. Most people should use the simpler options above.</div>
            )}
            {meta.kind === 'exchange' && (
              <div className="flex rounded-xl bg-black/20 p-1 text-xs font-semibold">
                {(['graph', 'ews'] as const).map((m) => (
                  <button key={m} onClick={() => setExchangeMode(m)} className={`flex-1 rounded-lg py-1.5 ${exchangeMode === m ? 'bg-white/10 text-white' : 'text-ink-400'}`}>
                    {m === 'graph' ? 'Microsoft 365 / Online' : 'On-premises (EWS)'}
                  </button>
                ))}
              </div>
            )}

            <ol className="space-y-3">
              {meta.steps
                .filter((_, i) => meta.kind !== 'exchange' || i === (exchangeMode === 'graph' ? 0 : 1))
                .map((s, i) => (
                  <li key={i} className="flex gap-3 text-sm">
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold text-white" style={{ background: `${meta.color}55` }}>{i + 1}</span>
                    <div className="pt-0.5 text-ink-200">
                      {s.text}
                      {s.link && (
                        <button className="mt-1.5 flex items-center gap-1 text-xs font-semibold text-indigo-300 hover:text-indigo-200" onClick={() => api.open(s.link!.url)}>
                          {s.link.label} <ExternalLink size={12} />
                        </button>
                      )}
                    </div>
                  </li>
                ))}
            </ol>

            {meta.kind === 'google' && (
              <button className="btn btn-ghost w-full justify-center" onClick={async () => {
                try {
                  const text = await api.readClientJson()
                  if (text) setClientJson(text)
                } catch (err) {
                  setMessage({ ok: false, text: (err as Error).message })
                }
              }}>
                <FileJson size={16} /> {clientJson ? 'Client JSON loaded ✓' : 'Load client_secret…json'}
              </button>
            )}

            {meta.kind === 'microsoft' && (
              <label className="flex items-center justify-between text-xs text-ink-300">
                Allow work/school accounts too
                <Toggle on={tenant === 'common'} onChange={(v) => setTenant(v ? 'common' : 'consumers')} />
              </label>
            )}

            {meta.kind === 'iphoneBackup' && (
              <div className="space-y-2">
                {backups?.length === 0 && <div className="text-xs text-ink-400">No backups found (or Full Disk Access is missing).</div>}
                {backups?.map((b) => (
                  <button key={b.path} disabled={b.encrypted} onClick={() => setValues({ path: b.path })} className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left text-sm ${values.path === b.path ? 'border-pink-400/60 bg-pink-400/10' : 'border-white/10 bg-black/20'} disabled:opacity-50`}>
                    <FolderOpen size={16} />
                    <div className="flex-1">
                      <div className="font-semibold text-white">{b.deviceName}</div>
                      <div className="text-xs text-ink-400">{b.date ? new Date(b.date).toLocaleString() : 'Unknown date'}{b.encrypted ? ' · encrypted (not supported)' : ''}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {fields.length > 0 && (
              <div className="space-y-3">
                {fields.map((f) =>
                  f.type === 'checkbox' ? (
                    <label key={f.key} className="flex items-center justify-between gap-3 text-xs text-ink-300">
                      {f.label}
                      <Toggle on={(values[f.key] as boolean | undefined) ?? f.default ?? false} onChange={(v) => setValues((s) => ({ ...s, [f.key]: v }))} />
                    </label>
                  ) : (
                    <label key={f.key} className="block">
                      <span className="mb-1 block text-xs font-semibold text-ink-300">{f.label}</span>
                      <input
                        className="field"
                        type={f.type}
                        placeholder={f.placeholder}
                        autoComplete="off"
                        spellCheck={false}
                        value={String(values[f.key] ?? '')}
                        onChange={(e) => setValues((s) => ({ ...s, [f.key]: e.target.value }))}
                        disabled={meta.kind === 'google' && !!clientJson}
                      />
                      {'hint' in f && f.hint && <span className="mt-1 block text-[11px] text-ink-400">{f.hint}</span>}
                    </label>
                  )
                )}
              </div>
            )}

            {meta.auth === 'fda' && (
              <button className="btn btn-ghost w-full justify-center" onClick={() => api.privacy('fullDisk')}>
                <HardDrive size={16} /> Open Full Disk Access settings
              </button>
            )}

            <button className="btn btn-primary w-full justify-center py-2.5" disabled={!!busy || !ready} onClick={connect}>
              {busy ? <LoaderCircle size={16} className="animate-spin" /> : meta.auth.startsWith('oauth') || (meta.kind === 'exchange' && exchangeMode === 'graph') ? <KeyRound size={16} /> : <ShieldCheck size={16} />}
              {busy ?? (status?.configured ? 'Reconnect & import' : meta.group === 'usage' ? 'Connect & scan' : 'Connect & import')}
            </button>
          </>
        )}

        <AnimatePresence>
          {message && (
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className={`flex gap-2 rounded-xl p-3 text-sm ${message.ok ? 'bg-emerald-400/10 text-emerald-200' : 'bg-red-400/10 text-red-200'}`}>
              {message.ok ? <Check size={16} className="mt-0.5 shrink-0" /> : <TriangleAlert size={16} className="mt-0.5 shrink-0" />}
              <span className="selectable">{message.text}</span>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex gap-2 rounded-xl bg-white/[.03] p-3 text-[11px] leading-relaxed text-ink-400">
          <ShieldCheck size={14} className="mt-0.5 shrink-0 text-indigo-300" /> {meta.privacy}
        </div>
      </div>

      <div className="flex justify-end border-t border-white/5 p-3">
        <button className="btn btn-ghost py-1.5 text-xs" onClick={onNext}>
          {status?.configured ? 'Next source' : 'Skip'} <ChevronRight size={14} />
        </button>
      </div>
    </Card>
  )
}
