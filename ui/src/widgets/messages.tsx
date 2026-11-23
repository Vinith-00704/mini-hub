import { MessageSquare } from 'lucide-react'
import { Tag } from '../components/look/index.ts'
import { chatWho, EventList, messageApp } from './list.tsx'
import { strings, type TileProps } from './settings.ts'

export function MessagesTile({ settings = {} }: TileProps) {
  const apps = strings(settings, 'apps')
  return (
    <EventList
      title="Messages"
      types={['sms', 'chat']}
      limit={7}
      {...(apps.length ? { keep: e => apps.includes(messageApp(e)) } : {})}
      inbox="messages"
      scope="phone.messages.read"
      label="Messages (SMS and chat apps)"
      icon={<MessageSquare aria-hidden size={14} />}
      notConnected="SMS and chat messages arrive from your phone once it is paired. Pair it in Devices."
      line={e => ({
        who: chatWho(e),
        text: e.body ?? e.title ?? '',
        tag: (
          <Tag tone="muted" className="hidden sm:inline-flex">
            {messageApp(e)}
          </Tag>
        ),
      })}
    />
  )
}
