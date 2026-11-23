// Add device (docs/07 > Devices): what kind of device, then that kind's own steps. A phone is paired with a code; a mail
// account is set up by the hub's guided steps.

import { Mail, Smartphone } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Button } from '../../components/look/index.ts'
import { Tile } from '../../components/ui/Tile.tsx'
import { AddPhone } from './AddPhone.tsx'
import { SetupWizard } from './SetupWizard.tsx'

export type AddKind = 'choose' | 'phone' | 'mail'

/** Which step "#/devices?add=…" opens: phone and mail go straight in; anything else (Home's `add=1`) shows the choice. */
export const addKindOf = (hash: string): AddKind | null => {
  const value = /[?&]add=([^&]*)/.exec(hash)?.[1]
  if (value === undefined) return null
  return value === 'phone' || value === 'mail' ? value : 'choose'
}

const card = 'flex min-h-32 flex-col items-start gap-2 border-2 border-ink bg-card p-[var(--pad-tile)] text-left shadow-[4px_4px_0_var(--shadow)] hover:bg-card-bar'

function Kind({ icon, name, text, onPick, first = false }: { icon: ReactNode; name: string; text: string; onPick: () => void; first?: boolean }) {
  return (
    <li>
      <button type="button" onClick={onPick} className={`${card} h-full w-full`} autoFocus={first}>
        <span className="text-accent">{icon}</span>
        <span className="text-[14px] font-extrabold uppercase">{name}</span>
        <span className="text-small text-ink-2">{text}</span>
      </button>
    </li>
  )
}

export function AddDevice({ initial, onClose }: { initial: AddKind; onClose: () => void }) {
  const [kind, setKind] = useState<AddKind>(initial)
  if (kind === 'phone') return <AddPhone onClose={onClose} />
  if (kind === 'mail') return <SetupWizard connector="mail" onClose={onClose} />
  return (
    <div
      className="max-w-xl"
      onKeyDown={e => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          onClose()
        }
      }}
    >
      <Tile title="Add a device">
        <ul className="grid grid-cols-1 gap-3 min-[600px]:grid-cols-2">
          <Kind first icon={<Smartphone aria-hidden size={18} />} name="Phone" text="Pair your phone with this PC." onPick={() => setKind('phone')} />
          <Kind icon={<Mail aria-hidden size={18} />} name="Mail account" text="Read and send mail from Gmail, Outlook or another provider." onPick={() => setKind('mail')} />
        </ul>
        <div>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </Tile>
    </div>
  )
}
