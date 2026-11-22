// How the dashboard looks, and where its data is.

import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { patch } from '../../app/api.ts'
import { useMini, useSettings, type UiSettings } from '../../app/queries.ts'
import { Segmented } from '../../components/ui/Segmented.tsx'
import { Switch } from '../../components/ui/Switch.tsx'
import { Tile } from '../../components/ui/Tile.tsx'
import { accentFor } from '../../design/color.ts'
import { applyLook } from '../frame/look.ts'

const ACCENTS = ['bot', 'claude', 'blue', 'green', 'pink', 'orange', 'purple'] as const

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-[var(--row)] flex-wrap items-center gap-4 border-b border-line/60 py-2 last:border-0">
      <div className="min-w-0 flex-1">
        <div className="text-body">{label}</div>
        {hint && <div className="text-small text-ink-3">{hint}</div>}
      </div>
      {children}
    </div>
  )
}

export function Settings() {
  const client = useQueryClient()
  const settings = useSettings()
  const botAccent = useMini().data?.profile?.accent
  const save = useMutation({
    mutationFn: (p: Partial<UiSettings>) => patch<UiSettings>('/v1/settings', p),
    onSuccess: next => {
      applyLook(next, botAccent)
      client.setQueryData(['settings'], (old: UiSettings | undefined) => ({ ...old, ...next }))
    },
  })
  const s = settings.data
  if (!s) return <Tile title="Settings" state={settings.isError ? 'error' : 'loading'} {...(settings.error ? { error: settings.error.message } : {})} />

  return (
    <div className="flex max-w-3xl flex-col gap-3">
      <Tile title="Appearance">
        <Field label="Theme">
          <Segmented
            label="Theme"
            value={s.theme}
            onChange={theme => save.mutate({ theme })}
            options={[
              { value: 'dark', label: 'Dark' },
              { value: 'light', label: 'Light' },
              { value: 'system', label: 'System' },
            ]}
          />
        </Field>
        <Field label="Accent" hint="Follow my bot uses your bot's own colour.">
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Accent">
            {ACCENTS.map(a => (
              <button
                key={a}
                type="button"
                role="radio"
                aria-checked={s.accent === a}
                aria-label={a === 'bot' ? 'Follow my bot' : a}
                title={a === 'bot' ? 'Follow my bot' : a}
                onClick={() => save.mutate({ accent: a })}
                className={`h-7 w-7 rounded-full border-2 ${s.accent === a ? 'border-ink' : 'border-transparent'}`}
                style={{ background: accentFor(a, botAccent) }}
              />
            ))}
          </div>
        </Field>
        <Field label="Density">
          <Segmented
            label="Density"
            value={s.density}
            onChange={density => save.mutate({ density })}
            options={[
              { value: 'comfortable', label: 'Comfortable' },
              { value: 'compact', label: 'Compact' },
            ]}
          />
        </Field>
        <Field label="Privacy mode" hint="Blurs message previews until you point at them.">
          <Switch checked={s.privacy} onChange={privacy => save.mutate({ privacy })} label="Privacy mode" />
        </Field>
      </Tile>
      <Tile title="About">
        <Field label="Version">
          <span className="tabular text-small text-ink-2">{s.version ?? ''}</span>
        </Field>
        <Field label="Data folder" hint="Encrypted. The key is kept by Windows.">
          <span className="tabular max-w-full truncate text-small text-ink-2" title={s.dataDir ?? ''}>
            {s.dataDir ?? ''}
          </span>
        </Field>
      </Tile>
      {save.error && <p className="text-small text-danger">{save.error.message}</p>}
    </div>
  )
}
