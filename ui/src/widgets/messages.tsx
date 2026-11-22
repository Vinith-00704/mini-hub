import { EventList } from './list.tsx'

export function MessagesTile() {
  return (
    <EventList
      title="Messages"
      types={['sms', 'chat']}
      limit={7}
      line={e => ({
        who: e.who ?? 'Unknown',
        text: e.body ?? e.title ?? '',
        tag: <span className="hidden shrink-0 text-micro text-ink-3 sm:inline">{e.type === 'sms' ? 'SMS' : (e.app ?? 'Chat')}</span>,
      })}
    />
  )
}
