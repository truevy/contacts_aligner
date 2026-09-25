import { motion } from 'framer-motion'
import { ArrowRight, Lock, Play, Sparkles } from 'lucide-react'
import { useStore } from '../lib/store'
import { api } from '../lib/api'
import { SOURCES } from '../lib/sources'
import { SourceIcon } from '../components/ui'

export function Welcome() {
  const { go, refreshInfo, loadData } = useStore()
  const startDemo = async () => {
    await api.loadDemo()
    await refreshInfo()
    await loadData()
    go('sources')
  }
  return (
    <div className="mx-auto flex min-h-full max-w-5xl flex-col items-center justify-center px-8 pb-16 text-center">
      <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 120 }} className="relative mb-10 h-44 w-44">
        {SOURCES.slice(0, 8).map((s, i) => {
          const a = (i / 8) * Math.PI * 2
          return (
            <motion.div
              key={s.kind}
              className="absolute"
              style={{ left: 70 + Math.cos(a) * 78, top: 70 + Math.sin(a) * 78 }}
              animate={{ x: [0, -Math.cos(a) * 58, 0], y: [0, -Math.sin(a) * 58, 0], opacity: [1, 0.2, 1] }}
              transition={{ duration: 4, repeat: Infinity, delay: i * 0.12, ease: 'easeInOut' }}
            >
              <SourceIcon kind={s.kind} size={32} />
            </motion.div>
          )
        })}
        <div className="absolute left-1/2 top-1/2 grid h-16 w-16 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 shadow-2xl shadow-fuchsia-500/40">
          <Sparkles className="text-white" />
        </div>
      </motion.div>
      <h1 className="font-display text-5xl font-bold tracking-tight text-white">Contacts Aligner</h1>
      <p className="mt-4 max-w-2xl text-lg text-ink-300">
        Bring Gmail, iCloud, Yahoo, Outlook, Exchange and Apple Contacts together. Your real mail, call and message history
        shows which address and number each person <em className="text-white">actually</em> uses, so the Matt you emailed last week stops hiding behind five dead addresses.
      </p>
      <div className="mt-10 flex gap-3">
        <button className="btn btn-primary px-6 py-3 text-base" onClick={async () => { await loadData(); go('sources') }}>
          Get started <ArrowRight size={18} />
        </button>
        <button className="btn btn-ghost px-6 py-3 text-base" onClick={startDemo}>
          <Play size={16} /> Explore with demo data
        </button>
      </div>
      <div className="mt-12 flex items-center gap-2 text-xs text-ink-400">
        <Lock size={13} /> Everything runs on this Mac. Credentials are encrypted with your Keychain, and nothing is written to any account until you review and approve it.
      </div>
    </div>
  )
}
