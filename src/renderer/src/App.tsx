import { AnimatePresence, motion } from 'framer-motion'
import { useEffect } from 'react'
import { Check } from 'lucide-react'
import { useStore, type Step } from './lib/store'
import { Welcome } from './pages/Welcome'
import { Sources } from './pages/Sources'
import { Summary } from './pages/Summary'
import { Preview } from './pages/Preview'
import { Destination } from './pages/Destination'
import { Review } from './pages/Review'

const STEPS: Array<{ id: Step; label: string }> = [
  { id: 'sources', label: 'Sources' },
  { id: 'summary', label: 'Summary' },
  { id: 'preview', label: 'Alignment' },
  { id: 'destination', label: 'Destination' },
  { id: 'review', label: 'Review & Push' }
]

function Stepper() {
  const { step, go, data, analysis } = useStore()
  const idx = STEPS.findIndex((s) => s.id === step)
  const reachable = (s: Step) =>
    s === 'sources' || (s === 'summary' && !!data?.contacts.length) || ((s === 'preview' || s === 'destination') && !!analysis) || (s === 'review' && step === 'review')
  return (
    <div className="drag flex h-14 shrink-0 items-center justify-center gap-1 border-b border-white/5 pl-20 pr-4">
      {STEPS.map((s, i) => {
        const done = i < idx
        const active = i === idx
        return (
          <div key={s.id} className="flex items-center">
            <button
              disabled={!reachable(s.id)}
              onClick={() => go(s.id)}
              className={`no-drag flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold transition ${active ? 'bg-white/10 text-white' : done ? 'text-ink-300 hover:text-white' : 'text-ink-400'} disabled:cursor-default`}
            >
              <span className={`grid h-5 w-5 place-items-center rounded-full text-[10px] ${active ? 'bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white' : done ? 'bg-emerald-500/20 text-emerald-300' : 'bg-white/5'}`}>
                {done ? <Check size={12} /> : i + 1}
              </span>
              {s.label}
            </button>
            {i < STEPS.length - 1 && <div className={`mx-1 h-px w-6 ${i < idx ? 'bg-emerald-400/40' : 'bg-white/10'}`} />}
          </div>
        )
      })}
    </div>
  )
}

export function App() {
  const { step, refreshInfo } = useStore()
  useEffect(() => {
    refreshInfo()
    const onFocus = () => refreshInfo()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refreshInfo])

  const Page = { welcome: Welcome, sources: Sources, summary: Summary, preview: Preview, destination: Destination, review: Review }[step]
  return (
    <div className="flex h-full flex-col">
      {step === 'welcome' ? <div className="drag h-10 shrink-0" /> : <Stepper />}
      <div className="relative min-h-0 flex-1">
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            className="absolute inset-0 overflow-y-auto scroll-thin"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.25 }}
          >
            <Page />
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}
