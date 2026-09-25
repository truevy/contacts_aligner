import { animate, motion, useMotionValue, useTransform } from 'framer-motion'
import { useEffect, type ReactNode } from 'react'
import type { SourceKind } from '@engine/types'
import { SOURCE_BY_KIND } from '../lib/sources'
import { DAY, YEAR } from '@engine/recency'

export function SourceIcon({ kind, size = 36 }: { kind: SourceKind; size?: number }) {
  const s = SOURCE_BY_KIND[kind]
  return (
    <div
      className="grid shrink-0 place-items-center rounded-xl font-bold text-white shadow-lg"
      style={{
        width: size,
        height: size,
        fontSize: size * (s.monogram.length > 1 && /[a-z!]/i.test(s.monogram) ? 0.36 : 0.44),
        background: `linear-gradient(135deg, ${s.color}, ${s.color}99)`,
        boxShadow: `0 6px 20px -6px ${s.color}88`,
        color: kind === 'icloud' ? '#0f172a' : 'white'
      }}
    >
      {s.monogram}
    </div>
  )
}

export function SourceChip({ kind, dim }: { kind: SourceKind; dim?: boolean }) {
  const s = SOURCE_BY_KIND[kind]
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
      style={{ background: `${s.color}${dim ? '14' : '26'}`, color: s.color, border: `1px solid ${s.color}40`, opacity: dim ? 0.55 : 1 }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.color }} />
      {s.short}
    </span>
  )
}

export function AnimatedNumber({ value, className }: { value: number; className?: string }) {
  const mv = useMotionValue(0)
  const rounded = useTransform(mv, (v) => Math.round(v).toLocaleString())
  useEffect(() => {
    const c = animate(mv, value, { duration: 0.9, ease: 'easeOut' })
    return () => c.stop()
  }, [value, mv])
  return <motion.span className={className}>{rounded}</motion.span>
}

/** Status ring around a source tile: grey = not set up, spinning = working, green = imported, red = error. */
export function StatusRing({ state, children, color }: { state: 'idle' | 'busy' | 'done' | 'error'; children: ReactNode; color: string }) {
  const stroke = state === 'done' ? '#34d399' : state === 'error' ? '#f87171' : state === 'busy' ? color : 'rgba(255,255,255,.12)'
  return (
    <div className="relative grid h-16 w-16 place-items-center">
      <svg className="absolute inset-0" viewBox="0 0 64 64">
        <circle cx="32" cy="32" r="29" fill="none" stroke="rgba(255,255,255,.06)" strokeWidth="3" />
        <motion.circle
          cx="32" cy="32" r="29" fill="none" stroke={stroke} strokeWidth="3" strokeLinecap="round"
          strokeDasharray="182" transform="rotate(-90 32 32)"
          initial={false}
          animate={state === 'busy' ? { strokeDashoffset: [182, 40, 182], rotate: [0, 360] } : { strokeDashoffset: state === 'idle' ? 182 : 0 }}
          transition={state === 'busy' ? { repeat: Infinity, duration: 1.4, ease: 'linear' } : { duration: 0.8 }}
          style={{ originX: '32px', originY: '32px' }}
        />
      </svg>
      {children}
    </div>
  )
}

export function Sparkline({ data, color = '#818cf8', width = 120, height = 26 }: { data: number[]; color?: string; width?: number; height?: number }) {
  const max = Math.max(1, ...data)
  const bw = width / data.length
  return (
    <svg width={width} height={height} className="shrink-0">
      {data.map((v, i) => {
        const h = v ? Math.max(2, (v / max) * (height - 2)) : 1
        return <rect key={i} x={i * bw + 0.5} y={height - h} width={Math.max(1, bw - 1.5)} height={h} rx={1} fill={v ? color : 'rgba(255,255,255,.08)'} opacity={v ? 0.35 + 0.65 * (i / data.length) : 1} />
      })}
    </svg>
  )
}

/** Green → amber → red by age of last use. */
export function recencyColor(lastUsed: number | undefined, now = Date.now()): string {
  if (!lastUsed) return '#64748b'
  const age = now - lastUsed
  if (age < 90 * DAY) return '#34d399'
  if (age < YEAR) return '#a3e635'
  if (age < 2 * YEAR) return '#fbbf24'
  if (age < 4 * YEAR) return '#fb923c'
  return '#f87171'
}

export function RecencyBar({ lastUsed, now = Date.now(), width = 110 }: { lastUsed?: number; now?: number; width?: number }) {
  // Log-ish scale over 10 years: fresh fills the bar, ancient is a sliver.
  const age = lastUsed ? (now - lastUsed) / YEAR : Infinity
  const pct = lastUsed ? Math.max(0.06, 1 - Math.log10(1 + age * 9) / Math.log10(91)) : 0
  const color = recencyColor(lastUsed, now)
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-white/8" style={{ width }}>
      <motion.div className="h-full rounded-full" style={{ background: color, boxShadow: `0 0 10px ${color}` }} initial={{ width: 0 }} animate={{ width: `${pct * 100}%` }} transition={{ duration: 0.6 }} />
    </div>
  )
}

export function Pill({ children, color, className = '' }: { children: ReactNode; color: string; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${className}`} style={{ background: `${color}22`, color, border: `1px solid ${color}44` }}>
      {children}
    </span>
  )
}

export function Toggle({ on, onChange, color = '#818cf8' }: { on: boolean; onChange: (v: boolean) => void; color?: string }) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        onChange(!on)
      }}
      className="relative h-5 w-9 shrink-0 rounded-full transition-colors"
      style={{ background: on ? color : 'rgba(255,255,255,.12)' }}
      role="switch"
      aria-checked={on}
    >
      <motion.span className="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow" animate={{ left: on ? 18 : 2 }} transition={{ type: 'spring', stiffness: 500, damping: 30 }} />
    </button>
  )
}

export function Card({ children, className = '', ...rest }: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`glass rounded-2xl ${className}`} {...rest}>
      {children}
    </div>
  )
}

export function Empty({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="grid place-items-center py-20 text-center">
      <div className="mb-3 text-ink-400">{icon}</div>
      <div className="text-lg font-semibold text-white">{title}</div>
      <div className="mt-1 max-w-md text-sm text-ink-400">{children}</div>
    </div>
  )
}
