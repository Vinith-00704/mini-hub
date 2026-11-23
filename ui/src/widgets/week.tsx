// This week: what came in and what Mini did, per day, from the hub's own counts (/v1/stats).

import { useStats } from '../app/queries.ts'
import { Bars, Button, Tag, Window } from '../components/look/index.ts'

const day = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short' }).toUpperCase()

export function WeekTile() {
  const stats = useStats(7)
  const days = stats.data?.days ?? []
  const values = days.map((d, i) => ({
    label: day(d.date),
    values: [d.cameIn.call + d.cameIn.sms + d.cameIn.chat + d.cameIn.notification + d.cameIn.mail, d.miniDid] as [number, number],
    today: i === days.length - 1,
  }))
  const any = values.some(v => v.values[0] + v.values[1] > 0)
  return (
    <Window
      title="This week"
      tag={<Tag>7 days</Tag>}
      state={stats.isPending ? 'loading' : stats.isError ? 'error' : any ? 'ready' : 'empty'}
      emptyText="Nothing came in this week, and Mini did nothing. Turn on what to collect in Permissions."
      emptyAction={
        <a href="#/permissions">
          <Button size="sm">Open Permissions</Button>
        </a>
      }
      {...(stats.error ? { error: stats.error.message } : {})}
      onRetry={() => void stats.refetch()}
      className="min-h-64"
    >
      <Bars days={values} />
    </Window>
  )
}
