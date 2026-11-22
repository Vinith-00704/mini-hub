// Small pieces used everywhere: status dots, chips, empty states, one-line text, relative times.

import type { ReactNode } from 'react'

type Tone = 'ok' | 'warn' | 'danger' | 'muted' | 'info'

const DOT: Record<Tone, string> = { ok: 'bg-ok', warn: 'bg-warn', danger: 'bg-danger', muted: 'bg-ink-3', info: 'bg-info' }
const CHIP: Record<Tone, string> = {
  ok: 'text-ok border-ok/40',
  warn: 'text-warn border-warn/40',
  danger: 'text-danger border-danger/40',
  muted: 'text-ink-2 border-line',
  info: 'text-info border-info/40',
}

/** A coloured dot always has a word beside it: colour is never the only signal. */
export function Dot({ tone, label }: { tone: Tone; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-small text-ink-2">
      <span aria-hidden className={`h-2 w-2 rounded-full ${DOT[tone]}`} />
      {label}
    </span>
  )
}

export function Chip({ tone = 'muted', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`inline-flex h-5 items-center rounded-chip border px-1.5 text-micro whitespace-nowrap ${CHIP[tone]}`}>{children}</span>
}

export function Empty({ text, action }: { text: string; action?: ReactNode }) {
  return (
    <div className="flex h-full min-h-20 flex-col items-start justify-center gap-2 text-small text-ink-3">
      <p>{text}</p>
      {action}
    </div>
  )
}

/** Text on one line: cut with an ellipsis, with the whole of it on hover. */
export function Line({ text, className = '' }: { text: string; className?: string }) {
  return (
    <span className={`block min-w-0 truncate ${className}`} title={text}>
      {text}
    </span>
  )
}

export function ago(at: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1000))
  if (s < 60) return 'now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.round(h / 24)
  return `${d}d`
}

export function Time({ at }: { at: number }) {
  return (
    <time className="tabular shrink-0 text-micro text-ink-3" dateTime={new Date(at).toISOString()} title={new Date(at).toLocaleString()}>
      {ago(at)}
    </time>
  )
}

const CODE_WORD = /\b(otp|code|pin|passcode|verification)\b/i
const NUMBER = /\b\d{4,8}\b/g

/**
 * One-time codes are hidden until the owner points at them. A message that talks about a code has every number of
 * code length hidden: guessing which of two numbers is the code would sometimes show the wrong one.
 */
export function Masked({ text }: { text: string }) {
  if (!CODE_WORD.test(text)) return <Line text={text} />
  const parts: Array<string | { digits: string }> = []
  let from = 0
  for (const m of text.matchAll(NUMBER)) {
    parts.push(text.slice(from, m.index), { digits: m[0] })
    from = m.index + m[0].length
  }
  if (parts.length === 0) return <Line text={text} />
  parts.push(text.slice(from))
  return (
    <span className="block min-w-0 truncate" title="Point at a hidden number to show it">
      {parts.map((p, i) =>
        typeof p === 'string' ? (
          p
        ) : (
          <span key={i} className="group/code relative inline-block cursor-default" tabIndex={0} aria-label="Hidden number, focus to show">
            <span className="group-hover/code:hidden group-focus/code:hidden tabular">••••••</span>
            <span className="hidden group-hover/code:inline group-focus/code:inline tabular">{p.digits}</span>
          </span>
        ),
      )}
    </span>
  )
}
