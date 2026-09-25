import { motion } from 'framer-motion'
import { useMemo, useState } from 'react'
import { AtSign, GitMerge, Layers, Phone, UserX, Users } from 'lucide-react'
import type { SourceSummary } from '@engine/types'
import { summarize, totals } from '@engine/stats'
import { useStore } from '../lib/store'
import { SOURCE_BY_KIND } from '../lib/sources'
import { AnimatedNumber, Card, SourceIcon } from '../components/ui'

type MetricKey = Exclude<keyof SourceSummary, 'source'>

const METRICS: Array<{ key: MetricKey; label: string; short: string; icon: typeof Users; color: string; hint: string }> = [
  { key: 'total', label: 'Contacts', short: 'Total', icon: Users, color: '#818cf8', hint: 'All cards in this source' },
  { key: 'noPhoneNoEmail', label: 'No phone & no email', short: 'No phone/email', icon: UserX, color: '#f87171', hint: 'Can’t be reached. Usually old imports or business cards.' },
  { key: 'emailNoPhone', label: 'Email but no phone', short: 'Email only', icon: AtSign, color: '#60a5fa', hint: 'Have an email address but no number' },
  { key: 'multipleEmails', label: 'Multiple emails', short: 'Multi-email', icon: Layers, color: '#fbbf24', hint: 'Where outdated addresses pile up' },
  { key: 'multiplePhones', label: 'Multiple phones', short: 'Multi-phone', icon: Phone, color: '#34d399', hint: 'Old landlines and past mobiles' }
]

export function Summary() {
  const { data, go, runAnalysis } = useStore()
  const summaries = useMemo(() => (data ? summarize(data.contacts).sort((a, b) => b.total - a.total) : []), [data])
  const all = totals(summaries)
  const [hover, setHover] = useState<string>()

  const preview = () => {
    go('preview')
    runAnalysis()
  }

  return (
    <div className="mx-auto max-w-7xl px-8 py-8">
      <div className="mb-8 flex items-end justify-between">
        <div>
          <h2 className="font-display text-3xl font-bold text-white">What we found</h2>
          <p className="mt-1 text-ink-400">
            {summaries.length} source{summaries.length === 1 ? '' : 's'} · {all.total.toLocaleString()} contact cards · {Object.keys(data?.usage ?? {}).length.toLocaleString()} addresses and numbers with usage history
          </p>
        </div>
        <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.98 }} className="btn btn-primary px-6 py-3 text-base" onClick={preview}>
          <GitMerge size={18} /> Preview Alignment Options
        </motion.button>
      </div>

      {/* Totals strip */}
      <div className="mb-6 grid grid-cols-5 gap-3">
        {METRICS.map((m, i) => (
          <motion.div key={m.key} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
            <Card className="relative overflow-hidden p-4" onMouseEnter={() => setHover(m.key)} onMouseLeave={() => setHover(undefined)}>
              <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full blur-2xl" style={{ background: `${m.color}33` }} />
              <m.icon size={18} style={{ color: m.color }} />
              <div className="mt-3 text-3xl font-bold text-white"><AnimatedNumber value={all[m.key]} /></div>
              <div className="text-xs font-semibold text-ink-300">{m.label}</div>
              <div className="mt-1 text-[11px] leading-snug text-ink-400">{m.hint}</div>
            </Card>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-5 gap-6">
        <Card className="col-span-3 p-6">
          <div className="mb-4 flex items-center justify-between">
            <div className="font-semibold text-white">By source</div>
            <Legend summaries={summaries} />
          </div>
          <GroupedBars summaries={summaries} highlight={hover} />
        </Card>
        <Card className="col-span-2 p-6">
          <div className="mb-4 font-semibold text-white">Share of all cards</div>
          <Donut summaries={summaries} />
        </Card>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 xl:grid-cols-3">
        {summaries.map((s, i) => (
          <SourceCard key={s.source} s={s} index={i} />
        ))}
      </div>
    </div>
  )
}

function Legend({ summaries }: { summaries: SourceSummary[] }) {
  return (
    <div className="flex flex-wrap gap-3">
      {summaries.map((s) => (
        <span key={s.source} className="flex items-center gap-1.5 text-xs text-ink-300">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: SOURCE_BY_KIND[s.source].color }} />
          {SOURCE_BY_KIND[s.source].short}
        </span>
      ))}
    </div>
  )
}

function GroupedBars({ summaries, highlight }: { summaries: SourceSummary[]; highlight?: string }) {
  const W = 720
  const H = 260
  const pad = { l: 40, b: 36, t: 10 }
  const max = Math.max(1, ...summaries.flatMap((s) => METRICS.map((m) => s[m.key])))
  const groupW = (W - pad.l) / METRICS.length
  const barW = Math.min(22, (groupW - 24) / Math.max(1, summaries.length))
  const y = (v: number) => (H - pad.b) - (v / max) * (H - pad.b - pad.t)
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(max * t))
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={W} y1={y(t)} y2={y(t)} stroke="rgba(255,255,255,.06)" />
          <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" fontSize="10" fill="#7c89ab">{t}</text>
        </g>
      ))}
      {METRICS.map((m, gi) => {
        const gx = pad.l + gi * groupW + (groupW - barW * summaries.length) / 2
        const dim = highlight && highlight !== m.key
        return (
          <g key={m.key} opacity={dim ? 0.25 : 1} style={{ transition: 'opacity .2s' }}>
            {summaries.map((s, si) => {
              const v = s[m.key]
              return (
                <motion.rect
                  key={s.source}
                  x={gx + si * barW + 1}
                  width={barW - 2}
                  rx={3}
                  fill={SOURCE_BY_KIND[s.source].color}
                  initial={{ y: H - pad.b, height: 0 }}
                  animate={{ y: y(v), height: Math.max(0, H - pad.b - y(v)) }}
                  transition={{ delay: 0.1 + gi * 0.08 + si * 0.03, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
                >
                  <title>{`${SOURCE_BY_KIND[s.source].short}: ${v} (${m.label})`}</title>
                </motion.rect>
              )
            })}
            <text x={pad.l + gi * groupW + groupW / 2} y={H - 14} textAnchor="middle" fontSize="11" fontWeight={600} fill={m.color}>{m.short}</text>
          </g>
        )
      })}
    </svg>
  )
}

function Donut({ summaries }: { summaries: SourceSummary[] }) {
  const total = summaries.reduce((n, s) => n + s.total, 0) || 1
  const R = 80
  const C = 2 * Math.PI * R
  let offset = 0
  return (
    <div className="flex items-center gap-6">
      <svg viewBox="0 0 200 200" className="w-48 shrink-0">
        <circle cx="100" cy="100" r={R} fill="none" stroke="rgba(255,255,255,.05)" strokeWidth="26" />
        {summaries.map((s, i) => {
          const len = (s.total / total) * C
          const el = (
            <motion.circle
              key={s.source}
              cx="100" cy="100" r={R} fill="none" stroke={SOURCE_BY_KIND[s.source].color} strokeWidth="26"
              strokeDasharray={`${len} ${C - len}`} transform="rotate(-90 100 100)"
              initial={{ strokeDashoffset: -offset + len, opacity: 0 }}
              animate={{ strokeDashoffset: -offset, opacity: 1 }}
              transition={{ delay: 0.15 + i * 0.1, duration: 0.6 }}
            />
          )
          offset += len
          return el
        })}
        <text x="100" y="96" textAnchor="middle" fontSize="28" fontWeight="700" fill="white">{total.toLocaleString()}</text>
        <text x="100" y="116" textAnchor="middle" fontSize="11" fill="#7c89ab">cards</text>
      </svg>
      <div className="flex-1 space-y-2">
        {summaries.map((s) => (
          <div key={s.source} className="flex items-center gap-2 text-sm">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: SOURCE_BY_KIND[s.source].color }} />
            <span className="flex-1 text-ink-200">{SOURCE_BY_KIND[s.source].short}</span>
            <span className="font-semibold text-white">{Math.round((s.total / total) * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function SourceCard({ s, index }: { s: SourceSummary; index: number }) {
  const meta = SOURCE_BY_KIND[s.source]
  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 + index * 0.05 }}>
      <Card className="p-5">
        <div className="mb-4 flex items-center gap-3">
          <SourceIcon kind={s.source} size={40} />
          <div>
            <div className="font-semibold text-white">{meta.name}</div>
            <div className="text-2xl font-bold" style={{ color: meta.color }}><AnimatedNumber value={s.total} /> <span className="text-sm font-medium text-ink-400">contacts</span></div>
          </div>
        </div>
        <div className="space-y-2.5">
          {METRICS.slice(1).map((m) => {
            const pct = s.total ? s[m.key] / s.total : 0
            return (
              <div key={m.key}>
                <div className="mb-1 flex justify-between text-xs">
                  <span className="text-ink-300">{m.label}</span>
                  <span className="font-semibold text-white">{s[m.key].toLocaleString()} <span className="text-ink-400">· {Math.round(pct * 100)}%</span></span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-white/5">
                  <motion.div className="h-full rounded-full" style={{ background: m.color }} initial={{ width: 0 }} animate={{ width: `${pct * 100}%` }} transition={{ delay: 0.3 + index * 0.05, duration: 0.7 }} />
                </div>
              </div>
            )
          })}
        </div>
      </Card>
    </motion.div>
  )
}
