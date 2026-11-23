// Everything anyone did, newest first, from the audit log and from what Mini did on phones (docs/07 > Activity), and a
// check that nobody changed the log.

import { useState } from 'react'
import { useAudit, useAuditCheck, useDevices, useEventsPerDevice, useGrants, type AuditRow, type Device, type EventRow } from '../../app/queries.ts'
import { Line, Time } from '../../components/ui/bits.tsx'
import { Button, Choice, Row, Tag, Window } from '../../components/look/index.ts'

const WHO: Record<string, string> = { person: 'You', agent: 'Mini', system: 'Mini Hub', device: 'A phone', voice: 'Voice' }

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
  '/v1/stats': 'the day’s numbers',
}

const DONE_BY: Record<string, string> = {
  grant: 'Changed a permission',
  approve: 'Answered a question from Mini',
  stop: 'Stopped Mini',
  resume: 'Resumed Mini',
  prompt: 'Asked Mini something',
  share: 'Shared with Mini',
  settings: 'Changed settings',
  delete: 'Deleted events',
  rename: 'Renamed a device',
  remove: 'Removed a device',
  'start-bot': 'Started the bot',
  'stop-bot': 'Stopped the bot',
  'pair-start': 'Started pairing a phone',
  pair: 'Paired a phone',
  'pair-cancel': 'Cancelled pairing',
  disconnect: 'Disconnected everything',
  start: 'Mini Hub started',
  'stop-hub': 'Mini Hub stopped',
  setup: 'Set up a connection',
  board: 'Changed a board',
  export: 'Exported a backup',
  import: 'Imported a backup',
  prune: 'Removed old items',
  'prune-audit': 'Removed old activity',
}

/** A read of events names what it covered: "Read 3 items: Reading mail". `labels` are the permissions' words, by scope. */
const describeRead = (r: AuditRow, labels: Record<string, string>): string | undefined => {
  const { scopes, count } = r.data
  if (!Array.isArray(scopes) || scopes.length === 0) return undefined
  const words = scopes.map(s => labels[String(s)] ?? String(s)).join(', ')
  if (r.outcome === 'waiting') return `Asked to read: ${words}`
  if (r.outcome === 'refused') return `Was refused: ${words}`
  return typeof count === 'number' ? `Read ${count} ${count === 1 ? 'item' : 'items'}: ${words}` : undefined
}

export const describeRow = (r: AuditRow, labels: Record<string, string> = {}): string => {
  if (r.action === 'read') {
    const said = describeRead(r, labels)
    if (said) return said
  }
  if (r.action === 'act') return `${r.caller === 'person' ? 'Ran' : 'Asked to run'} ${r.target ?? 'an action'}`
  if (r.action === 'read') return `Looked at ${READS[r.target ?? ''] ?? r.target ?? 'something'}`
  if (r.action === 'share') return `Shared ${r.target ?? 'an item'} with Mini`
  const base = DONE_BY[r.action] ?? r.action
  return r.scope ? `${base}: ${r.scope}` : base
}

export const outcomeChip = (r: AuditRow): { label: string; tone: 'ok' | 'warn' | 'danger' | 'muted' } => {
  if (r.outcome === 'refused') return { label: 'refused: switched off', tone: 'muted' }
  if (r.outcome === 'failed') return { label: 'failed', tone: 'danger' }
  if (r.outcome === 'waiting') return { label: 'waiting for you', tone: 'warn' }
  return { label: r.caller === 'agent' ? 'allowed' : 'done', tone: 'ok' }
}

const LIMIT = 200

type Tone = 'ok' | 'warn' | 'danger' | 'muted'

/** How one of Mini's actions (on a phone, or the PC's own record) ended, in the same words as the audit log's chips. */
export const miniActionChip = (e: EventRow): { label: string; tone: Tone } => {
  const { outcome, reason, approvalId } = e.data
  if (outcome === 'failed') return { label: 'failed', tone: 'danger' }
  if (outcome === 'refused') {
    if (reason === 'not-allowed' || reason === 'not-collected') return { label: 'refused: switched off', tone: 'muted' }
    if (reason === 'said-no' || reason === 'expired') return { label: 'you said no', tone: 'muted' }
    if (reason === 'stopped') return { label: 'refused: stopped', tone: 'muted' }
    return { label: 'refused', tone: 'muted' }
  }
  return typeof approvalId === 'string' && approvalId ? { label: 'you said yes', tone: 'ok' } : { label: 'allowed', tone: 'ok' }
}

/** "Mini · on <the phone's name>", or "on a phone" when the phone's name is not known. */
const miniWhere = (e: EventRow, devices: Device[]): string => {
  const d = devices.find(x => x.id === e.deviceId)
  return d ? `Mini · on ${d.name}` : 'Mini · on a phone'
}

type Entry = { key: string; at: number; title: string; detail: string; chip: { label: string; tone: Tone } }

export function Activity() {
  const [who, setWho] = useState<'all' | 'person' | 'agent'>('all')
  const audit = useAudit(who === 'all' ? {} : { caller: who })
  // What Mini did on phones is Mini's own, so "You" asks for neither the events nor the phones' names. The PC's own
  // actions are audit rows already (and their titles carry task text), so only the phones' events are asked for.
  const showPhones = who !== 'person'
  const devices = useDevices(showPhones)
  const devs = devices.data?.items ?? []
  const events = useEventsPerDevice('mini_action', String(LIMIT), devs.filter(d => d.kind === 'phone').map(d => d.id), showPhones)
  const eventRows = events.flatMap(q => q.data?.items ?? []).filter(e => e.data.on === 'phone')
  const eventsLoading = events.some(q => q.isLoading)
  const eventsFailed = events.some(q => q.isError)
  const check = useAuditCheck()
  const grants = useGrants()
  const labels = Object.fromEntries((grants.data?.items ?? []).map(g => [g.scope, g.label]))
  const [checked, setChecked] = useState(false)
  const entries: Entry[] = [
    ...(audit.data?.items ?? []).map(r => ({
      key: `a${r.id}`,
      at: r.at,
      title: describeRow(r, labels),
      detail: `${WHO[r.caller] ?? r.caller}${r.detail === 'voice' ? ' (voice)' : ''}`,
      chip: outcomeChip(r),
    })),
    ...(showPhones ? eventRows : []).map(e => ({
      key: `e${e.id}`,
      at: e.occurredAt,
      title: e.title ?? String(e.data.tool ?? 'An action').replace(/_/g, ' '),
      detail: miniWhere(e, devs),
      chip: miniActionChip(e),
    })),
  ]
    .sort((x, y) => y.at - x.at)
    .slice(0, LIMIT)
  const loading = audit.isPending || (showPhones && (devices.isLoading || eventsLoading))
  return (
    <div className="flex flex-col gap-4">
      {check.data && !check.data.ok && (
        <div role="alert" className="lk-stripes px-3 py-2">
          <span>The activity log has been changed by hand at entry {check.data.brokenAt}. Entries from there on cannot be trusted.</span>
        </div>
      )}
      {showPhones && (eventsFailed || devices.isError) && !audit.isError && (
        <p role="status" className="text-small text-danger">
          Mini's actions on your phones could not be loaded.
        </p>
      )}
      <Window
        title="Everything that happened"
        tag={entries.length ? <Tag>{entries.length >= LIMIT ? `${LIMIT} latest` : entries.length}</Tag> : undefined}
        action={<Choice label="Who" value={who} onChange={setWho} options={[{ value: 'all', label: 'Everyone' }, { value: 'person', label: 'You' }, { value: 'agent', label: 'Mini' }]} />}
        state={loading ? 'loading' : audit.isError ? 'error' : entries.length ? 'ready' : 'empty'}
        emptyText="Nothing has happened yet."
        {...(audit.error ? { error: audit.error.message } : {})}
        onRetry={() => void audit.refetch()}
      >
        <div className="flex flex-wrap items-center gap-3 border-b border-soft pb-3">
          <Button
            size="sm"
            busy={check.isFetching}
            onClick={() => {
              setChecked(true)
              void check.refetch()
            }}
          >
            Check the log
          </Button>
          {checked && check.error && !check.isFetching && (
            <span role="status" className="text-small text-danger">
              {check.error.message}
            </span>
          )}
          {checked && check.data && !check.isFetching && !check.error && (
            <span role="status" className={`text-small ${check.data.ok ? 'text-ok' : 'text-danger'}`}>
              {check.data.ok ? 'The log is whole: nothing was changed by hand.' : `Changed by hand at entry ${check.data.brokenAt}.`}
            </span>
          )}
        </div>
        <ul className="flex flex-col">
          {entries.map(r => (
            <Row key={r.key} title={<Line text={r.title} />} detail={r.detail} time={<Time at={r.at} />} trailing={<Tag tone={r.chip.tone}>{r.chip.label}</Tag>} />
          ))}
        </ul>
      </Window>
    </div>
  )
}
