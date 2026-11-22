import { EventList } from './list.tsx'

export function CallsTile() {
  return (
    <EventList
      title="Calls"
      types={['call']}
      line={e => {
        const missed = e.data.direction === 'missed'
        return { who: e.who ?? 'Unknown', text: e.title ?? (missed ? 'Missed call' : 'Call'), tone: missed ? 'warn' : 'muted' }
      }}
    />
  )
}
