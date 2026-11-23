// The time, large, and the date below it, in the person's own format. It updates every second with seconds on, else
// at each new minute.

import { useEffect, useState } from 'react'
import { Window } from '../components/look/index.ts'
import { flag, HOURS, oneOf, type Hours, type Settings, type TileProps } from './settings.ts'

/** The options for `toLocaleTimeString`: "As Windows does" leaves the 12 or 24 hours to the person's own region. */
export const timeOptions = (hours: Hours, seconds: boolean): Intl.DateTimeFormatOptions => ({
  hour: 'numeric',
  minute: '2-digit',
  ...(seconds ? { second: '2-digit' } : {}),
  ...(hours === 'system' ? {} : { hourCycle: hours === '12' ? 'h12' : 'h23' }),
})

const DATE: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' }

export const clockOf = (s: Settings): { hours: Hours; seconds: boolean; date: boolean } => ({
  hours: oneOf(s, 'hours', HOURS, 'system'),
  seconds: flag(s, 'seconds', false),
  date: flag(s, 'date', true),
})

/** The time now, renewed every second (`each` = 1000) or when the minute changes (60000). */
function useNow(each: 1000 | 60000): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    setNow(new Date())
    let timer: ReturnType<typeof setTimeout>
    const tick = () => {
      const t = new Date()
      setNow(t)
      timer = setTimeout(tick, each - (t.getTime() % each) + 20)
    }
    timer = setTimeout(tick, each - (Date.now() % each) + 20)
    return () => clearTimeout(timer)
  }, [each])
  return now
}

export function ClockTile({ settings = {} }: TileProps) {
  const { hours, seconds, date } = clockOf(settings)
  const now = useNow(seconds ? 1000 : 60000)
  return (
    <Window title="Clock" bare bodyClassName="@container justify-center gap-0.5">
      <time dateTime={now.toISOString()} className="tabular truncate font-mono leading-none font-bold" style={{ fontFamily: 'var(--font-mono)', fontSize: 'clamp(16px, 15cqw, 40px)' }}>
        {now.toLocaleTimeString(undefined, timeOptions(hours, seconds))}
      </time>
      {date && <span className="truncate text-small text-ink-2">{now.toLocaleDateString(undefined, DATE)}</span>}
    </Window>
  )
}
