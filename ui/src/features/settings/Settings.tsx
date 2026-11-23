// How the dashboard looks, and where its data is.

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, type ReactNode } from 'react'
import { patch } from '../../app/api.ts'
import { useSettings, type UiSettings } from '../../app/queries.ts'
import { Segmented } from '../../components/ui/Segmented.tsx'
import { Switch } from '../../components/ui/Switch.tsx'
import { Tile } from '../../components/ui/Tile.tsx'
import { applyLook } from '../frame/look.ts'
import { useBoardList } from '../boards/useBoards.ts'
import { BoardsSettings } from './BoardsSettings.tsx'
import { Data } from './Data.tsx'
import { Field } from './Field.tsx'
import { Network } from './Network.tsx'
import { StartUp } from './StartUp.tsx'

/** The sections, as `#/settings?section=<id>` names them (the command box links to these). */
export const SECTIONS = ['look', 'boards', 'data', 'network', 'startup', 'about'] as const
const sectionId = (id: string): string => `settings-${id}`

/** The section the address asks for, if it is one of ours. */
const wanted = (): string | undefined => {
  const id = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('section') ?? ''
  return (SECTIONS as readonly string[]).includes(id) ? id : undefined
}

function Section({ id, children }: { id: (typeof SECTIONS)[number]; children: ReactNode }) {
  return (
    <div id={sectionId(id)} tabIndex={-1} className="scroll-mt-3 outline-offset-2 focus-visible:outline-2 focus-visible:outline-accent">
      {children}
    </div>
  )
}

export function Settings() {
  const client = useQueryClient()
  const settings = useSettings()
  const save = useMutation({
    mutationFn: (p: Partial<UiSettings>) => patch<UiSettings>('/v1/settings', p),
    onSuccess: next => {
      applyLook(next)
      client.setQueryData(['settings'], (old: UiSettings | undefined) => ({ ...old, ...next }))
    },
  })
  const s = settings.data
  // The boards above Data and Network change their height when they arrive: the section asked for is found again then.
  const boards = useBoardList().status
  const ready = Boolean(s)

  // `#/settings?section=<id>`: the section comes into view and takes focus, on arriving and when the address changes.
  useEffect(() => {
    if (!ready) return
    const go = () => {
      const id = wanted()
      const el = id ? document.getElementById(sectionId(id)) : null
      if (!el) return
      el.scrollIntoView({ block: 'start' })
      el.focus({ preventScroll: true })
    }
    go()
    window.addEventListener('hashchange', go)
    return () => window.removeEventListener('hashchange', go)
  }, [ready, boards])

  if (!s) return <Tile title="Settings" state={settings.isError ? 'error' : 'loading'} {...(settings.error ? { error: settings.error.message } : {})} />

  return (
    <div className="flex max-w-3xl flex-col gap-3">
      <Section id="look">
        <Tile title="Look">
          <Field label="Theme" hint="Dark is pure black with Claude orange; light is cream paper. Follow Windows changes with it.">
            <Segmented
              label="Theme"
              value={s.theme}
              onChange={theme => save.mutate({ theme })}
              options={[
                { value: 'dark', label: 'Dark' },
                { value: 'light', label: 'Light' },
                { value: 'system', label: 'Follow Windows' },
              ]}
            />
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
      </Section>
      <Section id="boards">
        <BoardsSettings />
      </Section>
      <Section id="data">
        <Data />
      </Section>
      <Section id="network">
        <Network />
      </Section>
      <Section id="startup">
        <StartUp />
      </Section>
      <Section id="about">
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
      </Section>
      {save.error && <p className="text-small text-danger">{save.error.message}</p>}
    </div>
  )
}
