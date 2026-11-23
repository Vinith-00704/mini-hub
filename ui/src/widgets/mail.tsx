import { Mail } from 'lucide-react'
import { useDevices } from '../app/queries.ts'
import { Button, Tag, Window } from '../components/look/index.ts'
import { visible } from '../components/look/plainText.tsx'
import { EventList } from './list.tsx'
import { flag, text, type TileProps } from './settings.ts'

/** Mail shows its messages once a mail account is added; until then it says so plainly and offers to add one. */
export function MailTile({ settings = {} }: TileProps) {
  const devices = useDevices()
  if (devices.isPending) return <Window title="Mail" state="loading" />
  if (devices.isError) return <Window title="Mail" state="error" error={devices.error.message} onRetry={() => void devices.refetch()} />
  const accounts = devices.data.items.filter(d => d.kind === 'mail-account')
  const connected = accounts.length > 0
  // An account that has been removed is no longer asked for: the tile shows all of them.
  const account = accounts.find(d => d.id === text(settings, 'account'))?.id
  if (!connected)
    return (
      <Window
        title="Mail"
        tag={<Tag tone="muted">Not connected</Tag>}
        state="not-connected"
        notConnected="Add a mail account in Devices to see your mail here."
        emptyAction={
          <a href="#/devices?add=mail" className="self-start">
            <Button size="sm" variant="primary">
              Add a mail account
            </Button>
          </a>
        }
      />
    )
  return (
    <EventList
      title="Mail"
      types={['mail']}
      {...(account ? { device: account } : {})}
      unseenOnly={flag(settings, 'unseenOnly', false)}
      inbox="mail"
      scope="mail.read"
      label="Reading mail"
      icon={<Mail aria-hidden size={14} />}
      line={e => ({ who: visible(e.who ?? 'Unknown'), text: visible(e.title ?? '(no subject)'), tone: e.data.unread ? 'warn' : 'muted' })}
    />
  )
}
