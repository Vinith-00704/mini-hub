// Settings > Start-up: starting with Windows, and the key that opens Mini Hub. These belong to the desktop app.

import { useEffect, useState } from 'react'
import { Switch } from '../../components/ui/Switch.tsx'
import { Tile } from '../../components/ui/Tile.tsx'

type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>

const tauriInvoke: Invoke = async (command, args) => (await import('@tauri-apps/api/core')).invoke(command, args)

export function StartUp({ invoke = tauriInvoke }: { invoke?: Invoke }) {
  const inShell = '__TAURI_INTERNALS__' in window
  const [autostart, setAutostart] = useState<boolean | null>(null)
  const [shortcut, setShortcut] = useState<{ key: string; ok: boolean } | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!inShell) return
    void invoke('autostart_get').then(v => setAutostart(Boolean(v)), () => setAutostart(false))
    void invoke('shortcut_status').then(v => setShortcut(v as { key: string; ok: boolean }), () => setShortcut(null))
  }, [inShell, invoke])

  if (!inShell)
    return (
      <Tile title="Start-up">
        <p className="text-small text-ink-3">Starting with Windows and the key that opens Mini Hub are set in the desktop app.</p>
      </Tile>
    )

  return (
    <Tile title="Start-up">
      <div className="flex min-h-[var(--row)] items-center gap-4 border-b border-line/60 py-2">
        <div className="min-w-0 flex-1">
          <div className="text-body">Start with Windows</div>
          <div className="text-small text-ink-3">Mini Hub starts in the tray when you sign in, so your phone can catch up.</div>
        </div>
        <Switch
          checked={autostart === true}
          disabled={autostart === null}
          label="Start with Windows"
          onChange={on =>
            void invoke('autostart_set', { on }).then(
              v => (setAutostart(Boolean(v)), setError('')),
              e => setError(String(e)),
            )
          }
        />
      </div>
      <div className="flex min-h-[var(--row)] items-center gap-4 py-2">
        <div className="min-w-0 flex-1">
          <div className="text-body">Open Mini Hub</div>
          {shortcut && !shortcut.ok && <div className="text-small text-warn">This key is not available: another program is using it.</div>}
        </div>
        {shortcut && <span className="tabular text-small text-ink-2">{shortcut.key}</span>}
      </div>
      {error && <p className="text-small text-danger">{error}</p>}
    </Tile>
  )
}
