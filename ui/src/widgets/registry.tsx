// Every tile a board can hold (docs/07 > Widgets): its type as stored in a board's layout, its title, one line on what
// it shows, its default and smallest size in grid cells (12 columns, rows of 80 px), and how it renders from its own
// settings (the form for them is in features/boards/TileSettings.tsx).

import type { ReactNode } from 'react'
import { CallsTile } from './calls.tsx'
import { ClockTile } from './clock.tsx'
import { DevicesTile } from './devices-tile.tsx'
import { DeviceStatusTile } from './device-status.tsx'
import { MailTile } from './mail.tsx'
import { MessagesTile } from './messages.tsx'
import { MiniActivityTile } from './mini-activity.tsx'
import { MiniTile } from './mini.tsx'
import { NoteTile } from './note.tsx'
import { NotificationsTile } from './notifications.tsx'
import { QuickActionsTile } from './quick-actions.tsx'
import { TodayTile } from './today.tsx'
import { WaitingTile } from './waiting.tsx'
import { WeekTile } from './week.tsx'

export type WidgetDef = {
  type: string
  title: string
  about: string
  w: number
  h: number
  minW: number
  minH: number
  render: (settings: Record<string, unknown>) => ReactNode
}

const def = (type: string, title: string, about: string, size: [number, number], min: [number, number], render: WidgetDef['render']): WidgetDef => ({
  type,
  title,
  about,
  w: size[0],
  h: size[1],
  minW: min[0],
  minH: min[1],
  render,
})

export const WIDGETS: Record<string, WidgetDef> = Object.fromEntries(
  [
    def('today', 'Today', 'Counts since midnight: calls, messages, mail and what needs you.', [6, 2], [3, 2], s => <TodayTile settings={s} />),
    def('week', 'This week', 'What came in and what Mini did, day by day.', [5, 3], [4, 3], () => <WeekTile />),
    def('mini', 'Mini', 'The bot, what it is doing, and a box to ask it.', [4, 3], [3, 2], () => <MiniTile />),
    def('mini-activity', 'What Mini did', "Mini's latest actions.", [6, 3], [3, 2], s => <MiniActivityTile settings={s} />),
    def('device-status', 'Phone', 'Your phone: online, battery, last seen.', [3, 3], [2, 2], s => <DeviceStatusTile settings={s} />),
    def('devices', 'Devices', 'Every device and whether it is online.', [3, 3], [3, 2], () => <DevicesTile />),
    def('calls', 'Calls', 'Recent calls.', [4, 3], [3, 2], s => <CallsTile settings={s} />),
    def('messages', 'Messages', 'Recent SMS and chats.', [8, 3], [3, 2], s => <MessagesTile settings={s} />),
    def('notifications', 'Notifications', 'Other notifications from your phone.', [4, 3], [3, 2], s => <NotificationsTile settings={s} />),
    def('mail', 'Mail', 'Recent mail.', [6, 3], [3, 2], s => <MailTile settings={s} />),
    def('approvals', 'Waiting for you', 'What Mini asked to do, with Yes and No.', [4, 2], [3, 2], () => <WaitingTile />),
    def('quick-actions', 'Quick actions', 'Buttons of your own: send Mini a prompt or run an action.', [6, 1], [2, 1], s => <QuickActionsTile settings={s} />),
    def('note', 'Note', 'A note you write yourself.', [3, 2], [2, 1], s => <NoteTile settings={s} />),
    def('clock', 'Clock', 'The time and the date.', [2, 1], [2, 1], s => <ClockTile settings={s} />),
  ].map(d => [d.type, d]),
)
