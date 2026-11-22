import { EventList } from './list.tsx'

export function MailTile() {
  return <EventList title="Mail" types={['mail']} line={e => ({ who: e.who ?? 'Unknown', text: e.title ?? '(no subject)', tone: e.data.unread ? 'warn' : 'muted' })} />
}
