import { Phone } from 'lucide-react'
import { EventList } from './list.tsx'
import { flag, type TileProps } from './settings.ts'

export function CallsTile({ settings = {} }: TileProps) {
  const missedOnly = flag(settings, 'missedOnly', false)
  return (
    <EventList
      title="Calls"
      types={['call']}
      {...(missedOnly ? { keep: e => e.data.direction === 'missed' } : {})}
      inbox="calls"
      scope="phone.calls.read"
      label="Call history"
      icon={<Phone aria-hidden size={14} />}
      notConnected="Calls arrive from your phone once it is paired. Pair it in Devices."
      line={e => {
        const missed = e.data.direction === 'missed'
        return { who: e.who ?? 'Unknown', text: e.title ?? (missed ? 'Missed call' : 'Call'), tone: missed ? 'warn' : 'muted' }
      }}
    />
  )
}
