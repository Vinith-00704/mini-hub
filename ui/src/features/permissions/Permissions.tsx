// Everything Mini can reach, and whether it may (docs/07 > Permissions). Two controls per row: whether the data
// is collected at all, and whether Mini may use it. The PC's own access stays in the bot and is only shown here.

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { put } from '../../app/api.ts'
import { useGrants, useMini, type GrantRow } from '../../app/queries.ts'
import { Segmented, type Option } from '../../components/ui/Segmented.tsx'
import { Switch } from '../../components/ui/Switch.tsx'
import { Tile } from '../../components/ui/Tile.tsx'

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

const PC_NAMES: Record<string, string> = { screen: 'Screen', microphone: 'Microphone', computer: 'Computer control', files: 'Files' }

function Row({ row, onNote }: { row: GrantRow; onNote: (text: string) => void }) {
  const client = useQueryClient()
  const change = useMutation({
    mutationFn: (p: { collect?: boolean; mini?: Mini }) => put(`/v1/grants/${encodeURIComponent(row.target)}/${encodeURIComponent(row.scope)}`, p),
    onSuccess: (_d, p) => {
      if (p.mini) onNote(meaning(row, p.mini))
      return client.invalidateQueries({ queryKey: ['grants'] })
    },
    onError: (e: Error) => onNote(e.message),
  })
  return (
    <li className="flex min-h-[var(--row)] flex-wrap items-center gap-x-4 gap-y-1 border-b border-line/60 py-1.5 last:border-0">
      <span className="min-w-0 flex-1 text-body">{row.label}</span>
      {row.kind === 'important' && <span className="text-micro text-warn">Always asks first</span>}
      <span className="flex w-20 justify-center">
        {row.collectable ? <Switch checked={row.collect} onChange={v => change.mutate({ collect: v })} label={`Collect ${row.label}`} /> : <span className="text-ink-3">-</span>}
      </span>
      <Segmented label={`Mini may use ${row.label}`} value={row.mini} options={MINI_OPTIONS} onChange={v => change.mutate({ mini: v })} />
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
              <Row key={`${r.target}/${r.scope}`} row={r} onNote={setNote} />
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
    </div>
  )
}
