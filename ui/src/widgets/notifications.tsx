import { Bell } from 'lucide-react'
import { EventList, notificationApp, notificationText } from './list.tsx'
import { strings, type TileProps } from './settings.ts'

/** Notifications from apps that are not messaging: the ones the owner chose on the phone, under Apps to include. */
export function NotificationsTile({ settings = {} }: TileProps) {
  const apps = strings(settings, 'apps')
  return (
    <EventList
      title="Notifications"
      types={['notification']}
      limit={6}
      {...(apps.length ? { keep: e => apps.includes(notificationApp(e)) } : {})}
      inbox="notifications"
      scope="phone.notifications.read"
      label="Other notifications"
      icon={<Bell aria-hidden size={14} />}
      notConnected="Notifications arrive from your phone once it is paired. Pair it in Devices."
      line={e => ({ who: notificationApp(e), text: notificationText(e) })}
    />
  )
}
