import { motion } from 'framer-motion'
import { useMemo, useState } from 'react'
import { ArrowRight, Check, Download, FileSpreadsheet, FileText, Mail, TriangleAlert, Upload } from 'lucide-react'
import { CONTACT_SOURCES, type SourceKind } from '@engine/types'
import { exportContacts, type ExportFormat } from '@engine/export'
import { useStore } from '../lib/store'
import { useAligned, useRecentsPlan } from '../lib/derived'
import { api } from '../lib/api'
import { SOURCE_BY_KIND } from '../lib/sources'
import { Card, SourceIcon, Toggle } from '../components/ui'

const FORMATS: Array<{ id: ExportFormat; title: string; desc: string; file: string; icon: typeof FileText }> = [
  { id: 'google-csv', title: 'Google CSV', desc: 'Import at contacts.google.com', file: 'aligned-contacts-google.csv', icon: FileSpreadsheet },
  { id: 'outlook-csv', title: 'Outlook CSV', desc: 'Outlook / Microsoft 365 import format', file: 'aligned-contacts-outlook.csv', icon: FileSpreadsheet },
  { id: 'detailed-csv', title: 'Detailed CSV', desc: 'Adds when each email and number was last used, and which sources each person was merged from', file: 'aligned-contacts-detailed.csv', icon: FileSpreadsheet },
  { id: 'vcard', title: 'vCard (.vcf)', desc: 'Apple Contacts, iCloud, almost anything', file: 'aligned-contacts.vcf', icon: FileText }
]

export function Destination() {
  const { data, analysis, targets, set, createMissing, deleteDuplicates, cleanRecents, go, info } = useStore()
  const aligned = useAligned()
  const recents = useRecentsPlan()
  const [saved, setSaved] = useState<string>()

  // Read-only sources (e.g. an imported Google contacts file) can only be exported to.
  const available = useMemo(
    () => CONTACT_SOURCES.filter((k) => data?.contacts.some((c) => c.source === k) && info?.sources.find((s) => s.kind === k)?.writable !== false),
    [data, info]
  )
  const toggle = (k: SourceKind) => set({ targets: targets.includes(k) ? targets.filter((t) => t !== k) : [...targets, k] })
  const withEmail = aligned.filter((a) => a.emails.length).length

  const doExport = async (f: (typeof FORMATS)[number]) => {
    const content = exportContacts(aligned, f.id, analysis)
    const path = await api.save(content, f.file)
    if (path) setSaved(path)
  }

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <h2 className="font-display text-3xl font-bold text-white">Where should the aligned contacts go?</h2>
      <p className="mt-1 text-ink-400">
        {aligned.length.toLocaleString()} people after alignment ({withEmail.toLocaleString()} with an email). Export a file, push to your accounts, or both.
      </p>

      <div className="mt-8 mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-ink-400"><Download size={14} /> Export</div>
      <div className="grid grid-cols-4 gap-3">
        {FORMATS.map((f, i) => (
          <motion.button key={f.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} onClick={() => doExport(f)} className="glass group rounded-2xl p-5 text-left transition hover:bg-white/5">
            <f.icon className="mb-3 text-indigo-300 transition group-hover:scale-110" />
            <div className="font-semibold text-white">{f.title}</div>
            <div className="mt-1 text-xs text-ink-400">{f.desc}</div>
          </motion.button>
        ))}
      </div>
      {saved && <div className="mt-3 flex items-center gap-2 text-sm text-emerald-300"><Check size={16} /> Saved to <span className="selectable font-mono text-xs">{saved}</span></div>}

      <div className="mt-10 mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-ink-400"><Upload size={14} /> Push to accounts</div>
      <Card className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <div className="text-sm text-ink-300">Choose the accounts to update. Each one is backed up in full before anything changes.</div>
          <button className="btn btn-ghost py-1 text-xs" onClick={() => set({ targets: targets.length === available.length ? [] : available })}>
            {targets.length === available.length ? 'Select none' : 'Select all'}
          </button>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {available.map((k) => {
            const on = targets.includes(k)
            const meta = SOURCE_BY_KIND[k]
            return (
              <button key={k} onClick={() => toggle(k)} className={`flex items-center gap-3 rounded-xl border p-3 text-left transition ${on ? 'bg-white/[.06]' : 'border-white/10 bg-black/10 opacity-70 hover:opacity-100'}`} style={on ? { borderColor: `${meta.color}88`, boxShadow: `0 0 24px -8px ${meta.color}` } : undefined}>
                <SourceIcon kind={k} size={36} />
                <div className="flex-1">
                  <div className="font-semibold text-white">{meta.name}</div>
                  <div className="text-xs text-ink-400">{data!.contacts.filter((c) => c.source === k).length.toLocaleString()} cards now</div>
                </div>
                <span className={`grid h-5 w-5 place-items-center rounded-md border ${on ? 'border-transparent bg-emerald-400 text-ink-900' : 'border-white/20'}`}>{on && <Check size={14} />}</span>
              </button>
            )
          })}
        </div>

        {targets.includes('apple') && targets.some((t) => t === 'icloud' || t === 'google' || t === 'exchange') && (
          <div className="mt-4 flex gap-2 rounded-xl bg-amber-400/10 p-3 text-sm text-amber-100">
            <TriangleAlert size={16} className="mt-0.5 shrink-0" />
            Apple Contacts usually shows the same cards as your iCloud, Google or Exchange accounts, because it syncs them. Pushing to both can write the same card twice. Consider picking just one of them.
          </div>
        )}

        <div className="mt-5 grid grid-cols-3 gap-4 border-t border-white/5 pt-5">
          <Option title="Remove in-account duplicates" desc="When an account holds the same person twice, keep one merged card and delete the extras." on={deleteDuplicates} onChange={(v) => set({ deleteDuplicates: v })} />
          <Option title="Add missing people" desc="Create cards for people who exist in other sources but not in this account." on={createMissing} onChange={(v) => set({ createMissing: v })} />
          <Option
            title="Clean Mail autocomplete"
            desc={data?.recents.length ? `Remove ${recents.rowIds.length} stale entries from Mail’s Previous Recipients.` : 'Needs Mail.app history with Full Disk Access.'}
            on={cleanRecents && !!data?.recents.length}
            onChange={(v) => set({ cleanRecents: v })}
            icon={<Mail size={14} />}
          />
        </div>
      </Card>

      <div className="mt-8 flex justify-end">
        <button className="btn btn-primary px-6 py-3 text-base" disabled={!targets.length && !(cleanRecents && recents.rowIds.length)} onClick={() => go('review')}>
          Review changes <ArrowRight size={18} />
        </button>
      </div>
    </div>
  )
}

function Option({ title, desc, on, onChange, icon }: { title: string; desc: string; on: boolean; onChange: (v: boolean) => void; icon?: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <Toggle on={on} onChange={onChange} />
      <div>
        <div className="flex items-center gap-1.5 text-sm font-semibold text-white">{icon}{title}</div>
        <div className="text-xs text-ink-400">{desc}</div>
      </div>
    </div>
  )
}
