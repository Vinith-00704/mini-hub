// Every part of the look in every state, for checking by eye (development only; not in the navigation: #/look).

import { useState } from 'react'
import { Bar, Bars, Button, Choice, Cursor, Gauge, Munch, PixelBot, Row, Segments, Stat, Switch, Tag, Window } from '../../components/look/index.ts'

export function LookBook() {
  const [on, setOn] = useState(true)
  const [g, setG] = useState<'off' | 'ask' | 'on'>('ask')
  return (
    <div className="grid grid-cols-1 gap-4 min-[900px]:grid-cols-3">
      <Window title="Buttons" tag={<Tag tone="ok" pill>● Ready</Tag>}>
        <div className="flex flex-wrap gap-3">
          <Button variant="primary">Ask</Button>
          <Button>Show bot</Button>
          <Button variant="danger">Stop bot</Button>
          <Button variant="stop">Stop</Button>
          <Button size="sm" busy>
            Checking
          </Button>
          <Button disabled>Disabled</Button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Tag>Plain</Tag>
          <Tag tone="ok">Done</Tag>
          <Tag tone="warn">Waiting</Tag>
          <Tag tone="danger">Refused</Tag>
          <Tag tone="muted">Not connected</Tag>
          <Tag tone="fill">Charging</Tag>
          <Tag tone="accent">Hook</Tag>
        </div>
      </Window>
      <Window title="Controls">
        <Switch checked={on} onChange={setOn} label="Collect calls" />
        <Choice label="Mini may use calls" value={g} onChange={setG} options={[{ value: 'off', label: 'Off', quiet: true }, { value: 'ask', label: 'Ask' }, { value: 'on', label: 'On' }]} />
        <Segments value={9} of={12} label="Synced" />
        <Bar value={64} label="Battery" />
        <Bar value={100} label="Limit" limit="Usage limit reached" />
      </Window>
      <Window title="Mini">
        <div className="flex items-end gap-5">
          <PixelBot state="idle" size={48} />
          <PixelBot state="thinking" size={48} />
          <PixelBot state="asleep" size={48} />
          <PixelBot state="listening" size={48} />
        </div>
        <Munch width={260} label="Loading" />
        <p className="tabular text-small">
          <span className="text-accent-ink">&gt;</span> writing a reply <Cursor />
        </p>
      </Window>
      <Window title="Numbers">
        <div className="flex">
          <Stat label="Calls today" value={12} delta={3} />
          <Stat label="Messages" value={48} delta={-5} />
          <Stat label="Waiting" value={1} accent />
        </div>
      </Window>
      <Window title="Gauge">
        <Gauge value={80} tag="Charging" label="Battery" />
      </Window>
      <Window title="This week" className="min-h-64">
        <Bars days={['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((label, i) => ({ label, values: [[22, 30, 18, 27, 15, 24, 41][i]!, [7, 10, 5, 13, 4, 9, 15][i]!] as [number, number], today: i === 6 }))} />
      </Window>
      <Window title="Rows">
        <ul>
          <Row icon={<span>☎</span>} accent title="Asha Example" detail="Missed call" time="09:42" />
          <Row icon={<span>✉</span>} title="Priya Example" detail="Invoice for November" time="09:31" trailing={<Tag tone="ok">Seen</Tag>} />
        </ul>
      </Window>
      <Window title="Loading" state="loading" />
      <Window title="Empty" state="empty" emptyText="Nothing yet. Turn on what to collect in Permissions." emptyAction={<Button size="sm">Open Permissions</Button>} />
      <Window title="Mail" tag={<Tag tone="muted">Not connected</Tag>} state="not-connected" notConnected="Mail arrives with the mail update." />
      <Window title="Error" state="error" error="The hub is not answering. It may be starting, or stopped." onRetry={() => {}} />
    </div>
  )
}
