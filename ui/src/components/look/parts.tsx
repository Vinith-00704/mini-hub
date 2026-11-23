// The parts of the Claude look, for every screen of the dashboard (the phone app has the same parts in
// android/.../ui/look). See docs/superpowers/specs/2026-11-22-claude-look-design.md > The parts.

import type { ButtonHTMLAttributes, ReactNode } from 'react'
import './look.css'

export type PartState = 'ready' | 'loading' | 'empty' | 'error' | 'not-connected' | 'not-allowed'

/** A card drawn as a little window: three hollow squares and an uppercase title. Handles every state the same way. */
export function Window({
  title,
  tag,
  action,
  state = 'ready',
  emptyText = 'Nothing yet.',
  emptyAction,
  error,
  onRetry,
  notConnected,
  className = '',
  bodyClassName = '',
  bare = false,
  children,
}: {
  title: string
  tag?: ReactNode
  action?: ReactNode
  state?: PartState
  emptyText?: string
  emptyAction?: ReactNode
  error?: string
  onRetry?: () => void
  notConnected?: string
  className?: string
  bodyClassName?: string
  /** No title bar: for a tile one row high, where the bar would take most of it. The title is still its name. */
  bare?: boolean
  children?: ReactNode
}) {
  return (
    <section aria-label={title} className={`lk-win ${className}`}>
      {!bare && (
        <header className="lk-win-bar">
          <span className="lk-sq" aria-hidden>
            <i />
            <i />
            <i />
          </span>
          <h2 className="lk-win-title">{title}</h2>
          {tag}
          {action}
        </header>
      )}
      <div className={`lk-win-body ${bodyClassName}`}>
        {state === 'loading' && <Skeleton lines={3} />}
        {(state === 'empty' || state === 'not-allowed') && <Empty text={emptyText} action={emptyAction} />}
        {state === 'not-connected' && (
          <div className="flex flex-col gap-3">
            <div className="lk-stripes" style={{ height: 40 }}>
              <span>Not connected yet</span>
            </div>
            {notConnected && <p className="text-small text-ink-2">{notConnected}</p>}
            {emptyAction}
          </div>
        )}
        {state === 'error' && (
          <div className="flex flex-col items-start gap-2 border-2 border-danger p-3">
            <p role="alert" className="text-small text-danger">
              {error ?? 'This could not be loaded.'}
            </p>
            {onRetry && (
              <Button size="sm" onClick={onRetry}>
                Retry
              </Button>
            )}
          </div>
        )}
        {state === 'ready' && children}
      </div>
    </section>
  )
}

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'stop'

/** A button with the hard shadow. `busy` shows Mini munching instead of the label's end. */
export function Button({
  variant = 'secondary',
  size = 'md',
  busy = false,
  className = '',
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; busy?: boolean }) {
  return (
    <button type="button" className={`lk-btn ${variant} ${size === 'sm' ? 'sm' : ''} ${className}`} aria-busy={busy || undefined} {...rest}>
      {children}
      {busy && <Dots />}
    </button>
  )
}

/** Three dots that light one after another, in steps. */
export function Dots() {
  return (
    <span aria-hidden className="lk-dots inline-flex gap-[3px]">
      {[0, 1, 2].map(i => (
        <i key={i} className="block h-[4px] w-[4px] bg-current" style={{ animation: `lk-cursor 0.9s steps(1) ${i * 0.3}s infinite` }} />
      ))}
    </span>
  )
}

type Tone = 'ok' | 'danger' | 'warn' | 'muted' | 'fill' | 'accent' | 'plain'

export function Tag({ tone = 'plain', pill = false, children, className = '' }: { tone?: Tone; pill?: boolean; children: ReactNode; className?: string }) {
  return <span className={`lk-tag ${tone === 'plain' ? '' : tone} ${pill ? 'pill' : ''} ${className}`}>{children}</span>
}

/** A change against before: ▲ green, ▼ red, = grey. */
export function Chip({ delta }: { delta: number }) {
  const kind = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat'
  const sign = delta > 0 ? '▲' : delta < 0 ? '▼' : '='
  const words = delta > 0 ? `${delta} more than yesterday` : delta < 0 ? `${-delta} fewer than yesterday` : 'same as yesterday'
  return (
    <span className={`lk-chip ${kind}`} title={words} aria-label={words}>
      {sign}
      {delta === 0 ? '' : Math.abs(delta)}
    </span>
  )
}

/** A headline number. */
export function Stat({ label, value, delta, accent = false, onClick }: { label: string; value: number | string; delta?: number; accent?: boolean; onClick?: () => void }) {
  const body = (
    <>
      <span className="lk-label text-ink-2">{label}</span>
      <span className="flex items-center gap-2">
        <span className={`tabular text-[38px] leading-none font-black ${accent ? 'text-accent-ink' : ''}`} style={{ fontFamily: 'var(--font-sans)' }}>
          {value}
        </span>
        {delta !== undefined && <Chip delta={delta} />}
      </span>
    </>
  )
  const cls = 'flex flex-col gap-1 border-l-2 border-ink px-5 text-left'
  return onClick ? (
    <button type="button" onClick={onClick} className={`${cls} cursor-pointer hover:bg-card-bar`}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  )
}

/** A row of square cells filled up to a value. */
export function Segments({ value, of, label }: { value: number; of: number; label: string }) {
  const cells = Math.max(1, Math.min(of, 24))
  const filled = Math.round((Math.max(0, Math.min(value, of)) / Math.max(of, 1)) * cells)
  return (
    <div className="lk-seg" role="meter" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={of}>
      {Array.from({ length: cells }, (_, i) => (
        <i key={i} className={i < filled ? 'f' : ''} />
      ))}
    </div>
  )
}

/** An outlined bar with an orange fill; `limit` draws the striped "limit reached" state with its word. */
export function Bar({ value, max = 100, label, limit }: { value: number; max?: number; label: string; limit?: string }) {
  if (limit)
    return (
      <div className="lk-stripes moving" style={{ height: 22 }} role="status" aria-label={label}>
        <span>{limit}</span>
      </div>
    )
  const pct = Math.max(0, Math.min(100, (value / Math.max(max, 1)) * 100))
  return (
    <div className="lk-bar" role="meter" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}>
      <i style={{ width: `${pct}%`, borderRightWidth: pct >= 100 || pct === 0 ? 0 : undefined }} />
    </div>
  )
}

export function Row({ icon, accent = false, title, detail, time, trailing, onClick }: { icon?: ReactNode; accent?: boolean; title: ReactNode; detail?: ReactNode; time?: ReactNode; trailing?: ReactNode; onClick?: () => void }) {
  const inner = (
    <>
      {icon && <span className={`lk-ib ${accent ? 'acc' : ''}`}>{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-bold">{title}</span>
        {detail && <span className="block truncate text-small text-ink-2">{detail}</span>}
      </span>
      {time && <span className="tabular shrink-0 text-micro text-ink-3">{time}</span>}
      {trailing}
    </>
  )
  return onClick ? (
    <li>
      <button type="button" className="lk-row w-full cursor-pointer text-left hover:bg-card-bar" onClick={onClick}>
        {inner}
      </button>
    </li>
  ) : (
    <li className="lk-row">{inner}</li>
  )
}

/** The collect switch: a square track, orange when on, with the word beside it. */
export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} className="lk-switch" onClick={() => onChange(!checked)}>
      <span className="track">
        <span className="knob" />
      </span>
      <span className="word">{checked ? 'ON' : 'OFF'}</span>
    </button>
  )
}

export type Option<T extends string> = { value: T; label: string; quiet?: boolean }

/** OFF · ASK · ON (or any few values). A quiet choice (off) is grey when chosen, so it never looks like "on". */
export function Choice<T extends string>({ value, options, onChange, label, disabled }: { value: T; options: Option<T>[]; onChange: (v: T) => void; label: string; disabled?: boolean }) {
  return (
    <span role="radiogroup" aria-label={label} className="lk-choice">
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          aria-label={`${label}: ${o.label}`}
          disabled={disabled}
          className={o.quiet ? 'off' : ''}
          onClick={() => o.value !== value && onChange(o.value)}
        >
          {o.label.toUpperCase()}
        </button>
      ))}
    </span>
  )
}

export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading" className="flex flex-col gap-2">
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="lk-skel h-4" style={{ width: `${88 - i * 18}%` }} />
      ))}
    </div>
  )
}

export function Empty({ text, action }: { text: string; action?: ReactNode }) {
  return (
    <div className="flex h-full min-h-20 flex-col items-start justify-center gap-3">
      <div className="flex items-center gap-3">
        <PixelBot state="asleep" size={28} />
        <p className="text-small text-ink-2">{text}</p>
      </div>
      {action}
    </div>
  )
}

// --- Mini's pixel self, and the retro motion built on it ---

const MINI = ['............', '..AAAAAAAA..', '.AAAAAAAAAA.', 'AAAEAAAAEAAA', 'AAAEAAAAEAAA', 'AAAAAAAAAAAA', '.AAAAAAAAAA.', '..A.A..A.A..', '..A.A..A.A..', '............']
// The same with its mouth open: a wedge cut from the right side, for munching.
const MINI_OPEN = ['............', '..AAAAAAAA..', '.AAAAAAAAAA.', 'AAAEAAAAE...', 'AAAEAAAA....', 'AAAAAAAAA...', '.AAAAAAAAAA.', '..A.A..A.A..', '..A.A..A.A..', '............']

function Pixels({ rows, eye = 'var(--card)' }: { rows: string[]; eye?: string }) {
  return (
    <>
      {rows.flatMap((row, y) =>
        [...row].map((ch, x) =>
          ch === '.' ? null : <rect key={`${x}-${y}`} x={x} y={y} width={1.02} height={1.02} fill={ch === 'E' ? eye : 'var(--accent)'} />,
        ),
      )}
    </>
  )
}

export type BotLook = 'idle' | 'thinking' | 'working' | 'asleep' | 'listening'

/** Mini as pixel art in Claude orange, bobbing in steps; asleep it dims, blinks and lets out a "z". */
export function PixelBot({ state = 'idle', size = 40, label = 'Mini' }: { state?: BotLook; size?: number; label?: string }) {
  return (
    <span className="relative inline-block" style={{ width: size, height: (size * 10) / 12 }}>
      <svg viewBox="0 0 12 10" width={size} height={(size * 10) / 12} shapeRendering="crispEdges" className={`lk-bot ${state}`} role="img" aria-label={`${label}, ${state}`}>
        <Pixels rows={MINI} />
      </svg>
      {state === 'asleep' && size >= 24 && (
        <span className="lk-zzz" aria-hidden>
          z
        </span>
      )}
      {state === 'listening' && <span aria-hidden className="absolute -inset-1 border-2 border-danger" style={{ borderRadius: 999 }} />}
    </span>
  )
}

/** The loader: Mini walks along a row of dots, munching them. `width` is the strip's width in pixels. */
export function Munch({ width = 260, label = 'Working' }: { width?: number; label?: string }) {
  const steps = Math.max(6, Math.round(width / 16))
  return (
    <div
      className="lk-munch"
      role="status"
      aria-label={label}
      style={{ width, ['--munch-w' as string]: `${width}px`, ['--munch-steps' as string]: steps, ['--munch-ms' as string]: `${steps * 150}ms` }}
    >
      <div className="dots" />
      <div className="eaten" />
      <div className="walker">
        <svg viewBox="0 0 12 10" width={22} height={18} shapeRendering="crispEdges" style={{ position: 'absolute', top: 1 }}>
          <g className="a">
            <Pixels rows={MINI} />
          </g>
          <g className="b">
            <Pixels rows={MINI_OPEN} />
          </g>
        </svg>
      </div>
    </div>
  )
}

/** The block cursor that blinks while Mini writes. */
export function Cursor() {
  return <span aria-hidden className="lk-cursor" />
}
