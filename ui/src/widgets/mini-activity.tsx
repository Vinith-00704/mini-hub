// What Mini did lately, everywhere, with how each ended: its actions on the PC (the audit log) and on phones
// (mini_action events) together, counted the same way as the board's "Mini did" number.

import { Check, Clock, X } from 'lucide-react'
import { useAudit, useEvents } from '../app/queries.ts'
import { Line, Time } from '../components/ui/bits.tsx'
import { Row, Tag, Window } from '../components/look/index.ts'
import { DEFAULT_MINI_COUNT, MINI_COUNTS, oneOf, type TileProps } from './settings.ts'

type Item = { key: string; at: number; title: string; outcome: 'done' | 'refused' | 'failed' | 'waiting'; where: string }

const name = (target?: string) => (target ?? 'an action').replace(/@.*$/, '').replace(/^(\w+)\./, '$1 · ').replace(/_/g, ' ')

export function MiniActivityTile({ settings = {} }: TileProps) {
  const count = oneOf(settings, 'count', MINI_COUNTS, DEFAULT_MINI_COUNT)
  const audit = useAudit({ caller: 'agent', action: 'act', limit: String(count) })
  const events = useEvents({ type: 'mini_action', limit: String(count) })
  const items: Item[] = [
    ...(audit.data?.items ?? []).map(r => ({ key: `a${r.id}`, at: r.at, title: name(r.target), outcome: r.outcome as Item['outcome'], where: 'on this PC' })),
    ...(events.data?.items ?? []).map(e => ({
      key: `e${e.id}`,
      at: e.occurredAt,
      title: e.title ?? 'An action',
      outcome: (e.data.outcome === 'refused' ? 'refused' : 'done') as Item['outcome'],
      where: e.deviceId === 'hub' ? 'on this PC' : 'on a phone',
    })),
  ]
    .sort((x, y) => y.at - x.at)
    .slice(0, count)
  const pending = audit.isPending || events.isPending
  const error = audit.error ?? events.error
  return (
    <Window
      title="What Mini did"
      action={
        <a href="#/activity" className="lk-label text-[11px] text-ink-2 hover:text-ink">
          All →
        </a>
      }
      state={pending ? 'loading' : error ? 'error' : items.length ? 'ready' : 'empty'}
      emptyText="Mini has not done anything yet."
      {...(error ? { error: error.message } : {})}
      onRetry={() => (void audit.refetch(), void events.refetch())}
    >
      <ul className="flex flex-col">
        {items.map(i => (
          <Row
            key={i.key}
            icon={i.outcome === 'done' ? <Check aria-hidden size={14} /> : i.outcome === 'waiting' ? <Clock aria-hidden size={14} /> : <X aria-hidden size={14} />}
            accent={i.outcome === 'done'}
            title={<Line text={i.title} />}
            detail={i.where}
            time={<Time at={i.at} />}
            trailing={
              <Tag tone={i.outcome === 'done' ? 'ok' : i.outcome === 'waiting' ? 'warn' : 'danger'}>
                {i.outcome === 'done' ? 'Done' : i.outcome === 'waiting' ? 'Waiting' : i.outcome === 'refused' ? 'Refused' : 'Failed'}
              </Tag>
            }
          />
        ))}
      </ul>
    </Window>
  )
}
