// Everything anyone did, newest first, from the audit log (docs/07 > Activity).

import { useState } from 'react'
import { useAudit, useAuditCheck, type AuditRow } from '../../app/queries.ts'
import { Segmented } from '../../components/ui/Segmented.tsx'
import { Chip, Line, Time } from '../../components/ui/bits.tsx'
import { Tile } from '../../components/ui/Tile.tsx'

const WHO: Record<string, string> = { person: 'You', agent: 'Mini', system: 'Mini Hub', device: 'A device', voice: 'Voice' }

const READS: Record<string, string> = {
  '/v1/events': 'calls, messages and other events',
  '/v1/events/:id': 'one event',
  '/v1/state': 'what is connected',
  '/v1/grants': 'its permissions',
  '/v1/audit': 'its own activity',
  '/v1/actions': 'what it can do',
  '/v1/devices': 'the devices',
  '/v1/people': 'who has been in touch',
  '/v1/tickets/:id': 'how a request went',
}

const DONE_BY: Record<string, string> = {
  grant: 'Changed a permission',
  approve: 'Answered a question from Mini',
  stop: 'Stopped Mini',
  resume: 'Resumed Mini',
  prompt: 'Asked Mini something',
  settings: 'Changed settings',
  delete: 'Deleted events',
  rename: 'Renamed a device',
  'start-bot': 'Started the bot',
  'stop-bot': 'Stopped the bot',
  start: 'Mini Hub started',
  'stop-hub': 'Mini Hub stopped',
}

export const describeRow = (r: AuditRow): string => {
  if (r.action === 'act') return `${r.caller === 'person' ? 'Ran' : 'Asked to run'} ${r.target ?? 'an action'}`
  if (r.action === 'read') return `Looked at ${READS[r.target ?? ''] ?? r.target ?? 'something'}`
  const base = DONE_BY[r.action] ?? r.action
  return r.scope ? `${base}: ${r.scope}` : base
}

export const outcomeChip = (r: AuditRow): { label: string; tone: 'ok' | 'warn' | 'danger' | 'muted' } => {
  if (r.outcome === 'refused') return { label: 'refused: switched off', tone: 'muted' }
  if (r.outcome === 'failed') return { label: 'failed', tone: 'danger' }
  if (r.outcome === 'waiting') return { label: 'waiting for you', tone: 'warn' }
  return { label: r.caller === 'agent' ? 'allowed' : 'done', tone: 'ok' }
}

export function Activity() {
  const [who, setWho] = useState<'all' | 'person' | 'agent'>('all')
  const audit = useAudit(who === 'all' ? {} : { caller: who })
  const check = useAuditCheck()
  const rows = audit.data?.items ?? []
  return (
    <div className="flex flex-col gap-3">
      {check.data && !check.data.ok && (
        <div role="alert" className="rounded-tile border border-danger/50 bg-danger/10 px-4 py-3 text-body">
          The activity log has been changed by hand at entry {check.data.brokenAt}. Entries from there on cannot be trusted.
        </div>
      )}
      <Tile
        title="Activity"
        action={
          <Segmented
            label="Who"
            value={who}
            onChange={setWho}
            options={[
              { value: 'all', label: 'Everyone' },
              { value: 'person', label: 'You' },
              { value: 'agent', label: 'Mini' },
            ]}
          />
        }
        state={audit.isPending ? 'loading' : audit.isError ? 'error' : rows.length ? 'ready' : 'empty'}
        emptyText="Nothing has happened yet."
        {...(audit.error ? { error: audit.error.message } : {})}
        onRetry={() => void audit.refetch()}
      >
        <ul className="flex flex-col">
          {rows.map(r => {
            const chip = outcomeChip(r)
            return (
              <li key={r.id} className="flex h-[var(--row)] min-w-0 items-center gap-3 border-b border-line/60 last:border-0">
                <Time at={r.at} />
                <span className="w-24 shrink-0 text-small text-ink-2">
                  {WHO[r.caller] ?? r.caller}
                  {r.detail === 'voice' ? ' (voice)' : ''}
                </span>
                <Line text={describeRow(r)} className="flex-1 text-body" />
                <Chip tone={chip.tone}>{chip.label}</Chip>
              </li>
            )
          })}
        </ul>
      </Tile>
    </div>
  )
}
