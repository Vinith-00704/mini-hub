// When Mini needs a yes, a card waits at the bottom right of every screen with exactly what will happen. The bell in
// the top bar tucks the cards away or brings them back; a new question always brings them back. A mail Mini asks to
// send shows every part of the mail, as it will go (docs/07 > Approval card).

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { api, post } from '../../app/api.ts'
import { useApprovals, useDevices, type Approval, type EventRow } from '../../app/queries.ts'
import { Button, Tag } from '../../components/look/index.ts'
import { PlainText, visible } from '../../components/look/plainText.tsx'

function Countdown({ until }: { until: number }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const s = Math.max(0, Math.round((until - now) / 1000))
  return <span className="tabular">{`${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`}</span>
}

/** A mail Mini asks to send or to save as a draft: its arguments, exactly as they will be used. */
type Mail = { to: string[]; cc: string[]; bcc: string[]; subject: string; text: string; replyTo?: { event?: number; folder?: string } }

const strings = (v: unknown): string[] | undefined => (Array.isArray(v) && v.every(x => typeof x === 'string') ? (v as string[]) : undefined)

/** The mail in an approval's arguments, or nothing when they are not those of a mail (the plain card shows then). */
const mailOf = (a: Approval): Mail | undefined => {
  if (a.action !== 'mail.send' && a.action !== 'mail.draft') return undefined
  const m = a.args as Record<string, unknown> | null
  if (typeof m !== 'object' || m === null || typeof m.subject !== 'string' || typeof m.text !== 'string') return undefined
  const to = strings(m.to)
  const cc = m.cc === undefined ? [] : strings(m.cc)
  const bcc = m.bcc === undefined ? [] : strings(m.bcc)
  if (!to || !cc || !bcc) return undefined
  const r = m.replyTo as { event?: unknown; folder?: unknown } | null | undefined
  const replyTo = r && typeof r === 'object' ? { ...(typeof r.event === 'number' ? { event: r.event } : {}), ...(typeof r.folder === 'string' ? { folder: r.folder } : {}) } : undefined
  return { to, cc, bcc, subject: m.subject, text: m.text, ...(replyTo ? { replyTo } : {}) }
}

/** The mail a reply answers: who sent it and its subject. */
function InReplyTo({ reply }: { reply: NonNullable<Mail['replyTo']> }) {
  const original = useQuery({ queryKey: ['events', 'one', reply.event], queryFn: () => api<EventRow>(`/v1/events/${reply.event}`), enabled: reply.event !== undefined })
  if (reply.event === undefined) return <>a mail in <PlainText text={reply.folder ?? 'the account'} /></>
  if (original.isError) return <>a mail that could not be loaded</>
  if (!original.data) return <>…</>
  return (
    <>
      <PlainText text={original.data.who ?? 'Unknown'} /> “<PlainText text={original.data.title ?? '(no subject)'} />”
    </>
  )
}

function Part({ name, children, pre = false }: { name: string; children: ReactNode; pre?: boolean }) {
  return (
    <div className="contents">
      <dt className="text-micro text-ink-3">{name}</dt>
      <dd className={`text-small break-words [overflow-wrap:anywhere] ${pre ? 'whitespace-pre-wrap' : ''}`} dir="auto">
        {children}
      </dd>
    </div>
  )
}

/** Every part of the mail, nothing cut: the text scrolls inside its own box, so the buttons below stay in view. */
function MailBlock({ a, mail }: { a: Approval; mail: Mail }) {
  const devices = useDevices()
  const address = devices.data?.items.find(d => d.id === a.deviceId)?.info?.address
  return (
    <div role="region" tabIndex={0} aria-label="Who the mail is for, and its subject" className="flex min-h-0 flex-col gap-2 overflow-y-auto">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <Part name="From">{typeof address === 'string' ? <PlainText text={address} /> : devices.isPending ? '…' : 'This account could not be found.'}</Part>
        <Part name="To">
          <PlainText text={mail.to.join(', ')} />
        </Part>
        {mail.cc.length > 0 && (
          <Part name="Cc">
            <PlainText text={mail.cc.join(', ')} />
          </Part>
        )}
        {mail.bcc.length > 0 && (
          <Part name="Bcc">
            <PlainText text={mail.bcc.join(', ')} />
          </Part>
        )}
        <Part name="Subject" pre>
          <PlainText text={mail.subject} />
        </Part>
        {mail.replyTo && (
          <Part name="In reply to">
            <InReplyTo reply={mail.replyTo} />
          </Part>
        )}
      </dl>
      <div
        role="region"
        tabIndex={0}
        aria-label="The text that will be sent"
        dir="auto"
        className="max-h-[40vh] shrink-0 overflow-auto border-2 border-ink bg-surface p-2 text-small break-words whitespace-pre-wrap [overflow-wrap:anywhere]"
      >
        <PlainText text={mail.text} />
      </div>
    </div>
  )
}

export function ApprovalCard({ a, compact = false }: { a: Approval; compact?: boolean }) {
  const client = useQueryClient()
  const answer = useMutation({
    mutationFn: (decision: 'yes' | 'no') => post(`/v1/approvals/${a.id}`, { decision }),
    onSettled: () => client.invalidateQueries({ queryKey: ['approvals'] }),
  })
  const mail = mailOf(a)
  return (
    <div
      role="alertdialog"
      aria-label="Mini asks"
      className={`lk-drop flex flex-col gap-2 ${compact ? '' : `lk-win max-h-[calc(100vh-8rem)] shrink-0 p-4 ${mail ? 'w-96' : 'w-80'}`}`}
    >
      <Tag tone="warn" className="self-start">
        Mini asks · <Countdown until={a.expiresAt} /> left
      </Tag>
      {/* A mail's summary holds the whole mail; its first line is the question and the block below shows the rest. */}
      <p
        className={`text-[15px] leading-snug font-bold break-words ${mail ? '' : 'max-h-[40vh] overflow-auto whitespace-pre-wrap'}`}
        {...(!mail && a.summary.length > 200 ? { tabIndex: 0 } : {})}
      >
        {mail ? visible(a.summary.split('\n')[0] ?? a.summary) : a.summary}
      </p>
      {mail && <MailBlock a={a} mail={mail} />}
      {a.risk === 'important' && <p className="text-micro text-warn">This kind of thing always asks first.</p>}
      <div className="mt-1 flex shrink-0 gap-2">
        <Button size="sm" onClick={() => answer.mutate('no')} disabled={answer.isPending}>
          No
        </Button>
        <Button size="sm" variant="primary" onClick={() => answer.mutate('yes')} disabled={answer.isPending}>
          Yes
        </Button>
      </div>
      {answer.error && <p className="text-micro text-danger">{answer.error.message}</p>}
    </div>
  )
}

export function ApprovalCards({ hidden = false, onShow }: { hidden?: boolean; onShow?: () => void }) {
  const { data } = useApprovals()
  const waiting = (data?.approvals ?? []).filter(a => a.state === 'waiting' && a.expiresAt > Date.now())
  // A new question is never left tucked away.
  const seen = useRef(new Set<string>())
  useEffect(() => {
    const fresh = waiting.some(a => !seen.current.has(a.id))
    waiting.forEach(a => seen.current.add(a.id))
    if (fresh && hidden) onShow?.()
  }, [waiting, hidden, onShow])
  // Announced politely and briefly: a mail's text is never read out on arrival, only that it needs checking.
  const announce = hidden
    ? ''
    : waiting
        .map(a => {
          const mail = mailOf(a)
          return mail ? (a.action === 'mail.draft' ? 'Mini wants to save a mail draft. Check it.' : 'Mini wants to send a mail. Check it.') : `Mini asks: ${a.summary}`
        })
        .join(' ')
  const region = (
    <div role="status" aria-live="polite" className="sr-only">
      {announce}
    </div>
  )
  if (!waiting.length || hidden) return region
  // Never taller than the space under the top bar, so the bell and Stop stay reachable; several tall cards scroll. The padding keeps their shadows inside.
  return (
    <>
      {region}
      <div className="fixed right-4 bottom-4 z-50 flex max-h-[calc(100vh-6rem)] flex-col gap-3 overflow-y-auto p-2">
        {waiting.map(a => (
          <ApprovalCard key={a.id} a={a} />
        ))}
      </div>
    </>
  )
}
