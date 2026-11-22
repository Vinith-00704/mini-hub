// The default board (docs/07 > Home). Arranging it is a later phase; for now its layout is fixed here.

import { CallsTile } from '../../widgets/calls.tsx'
import { DeviceStatusTile } from '../../widgets/device-status.tsx'
import { MailTile } from '../../widgets/mail.tsx'
import { MessagesTile } from '../../widgets/messages.tsx'
import { MiniActivityTile } from '../../widgets/mini-activity.tsx'
import { MiniTile } from '../../widgets/mini.tsx'
import { TodayTile } from '../../widgets/today.tsx'

export function Home() {
  return (
    <div className="grid grid-cols-1 gap-3 min-[900px]:grid-cols-12">
      <div className="min-[900px]:col-span-6">
        <TodayTile />
      </div>
      <div className="min-[900px]:col-span-3">
        <MiniTile />
      </div>
      <div className="min-[900px]:col-span-3">
        <DeviceStatusTile />
      </div>
      <div className="min-[900px]:col-span-5">
        <CallsTile />
      </div>
      <div className="min-[900px]:col-span-7">
        <MessagesTile />
      </div>
      <div className="min-[900px]:col-span-6">
        <MailTile />
      </div>
      <div className="min-[900px]:col-span-6">
        <MiniActivityTile />
      </div>
    </div>
  )
}
