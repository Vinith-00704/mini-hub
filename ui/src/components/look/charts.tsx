// The look's two charts: a semicircle gauge and an outlined bar chart (as in the approved samples).

import './look.css'

/** A semicircle: orange arc up to the value, the number in the middle, an optional black tag under it. */
export function Gauge({ value, max = 100, unit = '%', tag, label }: { value: number | null; max?: number; unit?: string; tag?: string; label: string }) {
  const r = 80
  const cx = 95
  const cy = 95
  const frac = value === null ? 0 : Math.max(0, Math.min(1, value / Math.max(max, 1)))
  const angle = Math.PI * (1 - frac)
  const x = cx + r * Math.cos(angle)
  const y = cy - r * Math.sin(angle)
  return (
    <div className="flex flex-col items-center" role="meter" aria-label={label} aria-valuenow={value ?? undefined} aria-valuemin={0} aria-valuemax={max}>
      <svg width="190" height="104" viewBox="0 0 190 104">
        <path d={`M${cx - r} ${cy} A${r} ${r} 0 0 1 ${cx + r} ${cy}`} fill="none" stroke="var(--soft)" strokeWidth="20" />
        {frac > 0 && <path d={`M${cx - r} ${cy} A${r} ${r} 0 0 1 ${x.toFixed(1)} ${y.toFixed(1)}`} fill="none" stroke="var(--accent)" strokeWidth="20" />}
        <path d={`M${cx - r - 10} ${cy} A${r + 10} ${r + 10} 0 0 1 ${cx + r + 10} ${cy} M${cx - r + 10} ${cy} A${r - 10} ${r - 10} 0 0 1 ${cx + r - 10} ${cy}`} fill="none" stroke="var(--ink)" strokeWidth="2" />
        <text x={cx} y={cy - 7} textAnchor="middle" fontFamily="var(--font-sans)" fontWeight="900" fontSize="38" fill="var(--ink)">
          {value === null ? '—' : `${Math.round(value)}${unit}`}
        </text>
      </svg>
      {tag && <span className="lk-tag fill -mt-1">{tag}</span>}
    </div>
  )
}

export type BarDay = { label: string; values: [number, number]; today?: boolean }

/**
 * Bars per day, two series side by side ("came in", "Mini did"); today's first bar is orange, the others soft;
 * a dashed line marks the average of the first series. The number over today's bar is its value.
 */
export function Bars({ days, legend = ['Came in', 'Mini did'] }: { days: BarDay[]; legend?: [string, string] }) {
  const max = Math.max(1, ...days.flatMap(d => d.values))
  const avg = days.reduce((n, d) => n + d.values[0], 0) / Math.max(days.length, 1)
  return (
    <div className="flex h-full min-h-40 flex-col gap-2">
      <div className="flex flex-wrap gap-4 text-micro font-extrabold tracking-[0.06em] uppercase">
        <span className="flex items-center gap-1.5">
          <i className="block h-3 w-3 border-[1.6px] border-ink bg-soft" />
          {legend[0]}
        </span>
        <span className="flex items-center gap-1.5">
          <i className="block h-3 w-3 border-[1.6px] border-ink bg-accent" />
          Today
        </span>
        <span className="flex items-center gap-1.5">
          <i className="block h-3 w-3 bg-ink" />
          {legend[1]}
        </span>
        <span className="text-ink-3">- - - Average</span>
      </div>
      <div className="relative flex min-h-0 flex-1 items-stretch gap-3 border-b-2 border-ink px-1 pt-5" role="img" aria-label={`${legend[0]} and ${legend[1]} per day: ${days.map(d => `${d.label} ${d.values[0]} and ${d.values[1]}`).join('; ')}`}>
        {avg > 0 && <div className="absolute right-0 left-0 border-t-2 border-dashed border-ink-3" style={{ bottom: `calc(${avg / max} * (100% - 20px))` }} />}
        {days.map(d => (
          <div key={d.label} className="relative flex flex-1 items-end gap-1">
            {d.today && (
              <span className="tabular absolute left-0 text-micro font-bold" style={{ bottom: `calc(${(d.values[0] / max) * 100}% + 2px)` }}>
                {d.values[0]}
              </span>
            )}
            <i className={`lk-drop block flex-1 border-[1.6px] border-ink ${d.today ? 'bg-accent' : 'bg-soft'}`} style={{ height: `${Math.max((d.values[0] / max) * 100, d.values[0] ? 2 : 0)}%` }} />
            <i className="lk-drop block flex-1 bg-ink" style={{ height: `${Math.max((d.values[1] / max) * 100, d.values[1] ? 2 : 0)}%` }} />
          </div>
        ))}
      </div>
      <div className="flex gap-3 px-1">
        {days.map(d => (
          <span key={d.label} className={`tabular flex-1 text-center text-micro ${d.today ? 'font-bold text-accent-ink' : 'text-ink-3'}`}>
            {d.today ? 'TODAY' : d.label}
          </span>
        ))}
      </div>
    </div>
  )
}
