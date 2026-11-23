// Everything Mini can reach, and whether it may (docs/07 > Permissions). Two controls per row: whether the data
// is collected at all, and whether Mini may use it. The PC's own access stays in the bot and is only shown here.

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { post, put } from '../../app/api.ts'
import { useDevices, useGrants, useMini, type Device, type GrantRow, type Needs } from '../../app/queries.ts'
import { Segmented, type Option } from '../../components/ui/Segmented.tsx'
import { Switch } from '../../components/ui/Switch.tsx'
import { Tile } from '../../components/ui/Tile.tsx'
import { Button } from '../../components/ui/Button.tsx'

type Mini = GrantRow['mini']

const MINI_OPTIONS: Array<Option<Mini>> = [
  { value: 'off', label: 'Off', quiet: true },
  { value: 'ask', label: 'Ask' },
  { value: 'on', label: 'On' },
]

/** One line on what a change means, in plain words. */
export const meaning = (row: GrantRow, value: Mini): string => {
  const what = row.label.toLowerCase()
  if (value === 'off') return `Mini can no longer use your ${what}.`
  if (row.kind === 'important') return `Mini will be able to ask you about ${what}. This always asks first, every time.`
  const how = value === 'ask' ? ', after asking you each time' : ''
  if (row.kind === 'read') return `Mini will be able to read your ${what}${how}.`
  return `Mini will be able to use ${what}${how}.`
}

/** What a phone says it still needs before a switch that is on does anything (the state frame's `needs`). */
export const NEED_LINES: Record<NonNullable<Needs[string]>, string> = {
  permission: "On, but the phone still needs Android's permission. Allow it in Mini on the phone, under Perms.",
  'notification-access': 'On, but notification access is off on the phone. Turn it on from Mini on the phone, under Perms.',
  apps: 'On, but no apps are chosen on the phone. Choose them in Mini on the phone, under Perms.',
}

/** The line for what this phone still needs for this scope, or undefined when it needs nothing (or says nothing). */
export const needLine = (device: Device | undefined, scope: string): string | undefined => {
  const needs = device?.state.needs as Needs | undefined
  const need = needs?.[scope]
  return need && need in NEED_LINES ? NEED_LINES[need] : undefined
}

const PC_NAMES: Record<string, string> = { screen: 'Screen', microphone: 'Microphone', computer: 'Computer control', files: 'Files' }

/** One switch row. `part` shows only its collect switch, or only Mini's choice, where a page splits the two (a mail account's). */
export function GrantRowItem({ row, onNote, part }: { row: GrantRow; onNote: (text: string) => void; part?: 'collect' | 'mini' }) {
  const client = useQueryClient()
  const device = useDevices().data?.items.find(d => d.id === row.target)
  const need = row.collect ? needLine(device, row.scope) : undefined
  const change = useMutation({
    mutationFn: (p: { collect?: boolean; mini?: Mini }) => put(`/v1/grants/${encodeURIComponent(row.target)}/${encodeURIComponent(row.scope)}`, p),
    onSuccess: (_d, p) => {
      if (p.mini) onNote(meaning(row, p.mini))
      else if (p.collect !== undefined) onNote(p.collect ? `Your ${row.label.toLowerCase()} will be collected from ${row.targetName}.` : `Nothing more of your ${row.label.toLowerCase()} is collected from ${row.targetName}.`)
      return client.invalidateQueries({ queryKey: ['grants'] })
    },
    onError: (e: Error) => onNote(e.message),
  })
  return (
    <li className="flex min-h-[var(--row)] flex-wrap items-center gap-x-4 gap-y-1 border-b border-line/60 py-1.5 last:border-0">
      <span className="min-w-0 flex-1 text-body">{row.label}</span>
      {part !== 'collect' && row.kind === 'important' && <span className="text-micro text-warn">Always asks first</span>}
      {part !== 'mini' && (
        <span className="flex w-20 justify-center">
          {row.collectable ? <Switch checked={row.collect} onChange={v => change.mutate({ collect: v })} label={`Collect ${row.label}`} /> : <span className="text-ink-3">-</span>}
        </span>
      )}
      {part !== 'collect' && <Segmented label={`Mini may use ${row.label}`} value={row.mini} options={MINI_OPTIONS} onChange={v => change.mutate({ mini: v })} />}
      {need && <p className="basis-full pb-1 text-micro text-ink-3">{need}</p>}
    </li>
  )
}

export function Permissions() {
  const grants = useGrants()
  const mini = useMini().data
  const [note, setNote] = useState('')
  const rows = grants.data?.items ?? []
  const groups = new Map<string, GrantRow[]>()
  for (const r of rows) groups.set(r.targetName, [...(groups.get(r.targetName) ?? []), r])
  const pc = Object.entries(mini?.permissions ?? {})

  return (
    <div className="flex max-w-4xl flex-col gap-3">
      <p className="text-body text-ink-2">Everything Mini can reach, and whether it may. New connections start with everything off.</p>
      {note && (
        <p role="status" className="rounded-control border border-line bg-surface px-3 py-2 text-small">
          {note}
        </p>
      )}
      {grants.isPending && <Tile title="Permissions" state="loading" />}
      {grants.isError && <Tile title="Permissions" state="error" error={grants.error.message} onRetry={() => void grants.refetch()} />}
      {[...groups.entries()].map(([name, list]) => (
        <Tile
          key={name}
          title={name}
          action={
            <span className="flex gap-4 text-micro text-ink-3">
              <span className="w-20 text-center">Collect</span>
              <span className="w-[118px] text-center">Mini may use</span>
            </span>
          }
        >
          <ul>
            {list.map(r => (
              <GrantRowItem key={`${r.target}/${r.scope}`} row={r} onNote={setNote} />
            ))}
          </ul>
        </Tile>
      ))}
      <Tile title="This PC (set in the bot)">
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-body text-ink-2">
          {pc.length ? pc.map(([k, on]) => <span key={k}>{`${PC_NAMES[k] ?? k}: ${on ? 'on' : 'off'}`}</span>) : <span>Mini is not running.</span>}
        </div>
        <p className="mt-2 text-small text-ink-3">Change these in the bot: right-click it, then Permissions.</p>
      </Tile>
      <Disconnect />
    </div>
  )
}

/** Disconnect everything (docs/03 > The stop button): Stop Mini, and close the link to every phone. */
function Disconnect() {
  const client = useQueryClient()
  const [asking, setAsking] = useState(false)
  const [note, setNote] = useState('')
  const go = useMutation({
    mutationFn: () => post('/v1/disconnect'),
    onSuccess: () => (setAsking(false), setNote('Done. Mini is stopped and phones are cut off until the hub starts again. Resume Mini at the top.'), client.invalidateQueries()),
    onError: (e: Error) => setNote(e.message),
  })
  return (
    <Tile title="Disconnect everything">
      <p className="text-small text-ink-2">Stops Mini and closes the link to every phone at once. Phones link again when Mini Hub next starts.</p>
      {!asking ? (
        <Button variant="danger" className="self-start" onClick={() => setAsking(true)}>
          Disconnect everything
        </Button>
      ) : (
        <div className="flex flex-wrap items-center gap-2 border-2 border-danger p-2 text-small">
          <span className="flex-1">Disconnect everything now?</span>
          <Button size="sm" variant="danger" busy={go.isPending} onClick={() => go.mutate()}>
            Disconnect
          </Button>
          <Button size="sm" onClick={() => setAsking(false)}>
            Cancel
          </Button>
        </div>
      )}
      {note && (
        <p role="status" className="text-small text-ink-2">
          {note}
        </p>
      )}
    </Tile>
  )
}
