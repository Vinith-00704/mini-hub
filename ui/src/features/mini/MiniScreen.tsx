// Mini's own screen: the conversation from the dashboard, what Mini is doing, and a question waiting in the bot,
// which is answered in the bot and never here.

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { post } from '../../app/api.ts'
import { useConversation, useMini } from '../../app/queries.ts'
import { BotSprite } from '../../components/BotSprite.tsx'
import { Button } from '../../components/ui/Button.tsx'
import { Dot } from '../../components/ui/bits.tsx'
import { botState } from '../frame/look.ts'

const PERMISSION_NAMES: Record<string, string> = { screen: 'Screen', microphone: 'Microphone', computer: 'Computer control', files: 'Files' }

export function MiniScreen() {
  const client = useQueryClient()
  const mini = useMini()
  const convo = useConversation()
  const [text, setText] = useState('')
  const [note, setNote] = useState('')
  const ask = useMutation({
    mutationFn: (t: string) => post('/v1/mini/prompt', { text: t }),
    onSuccess: () => (setText(''), setNote(''), client.invalidateQueries({ queryKey: ['mini'] })),
    onError: (e: Error) => setNote(e.message),
  })
  const startStop = useMutation({
    mutationFn: (run: boolean) => post(run ? '/v1/mini/start' : '/v1/mini/stop'),
    onSettled: () => client.invalidateQueries({ queryKey: ['mini'] }),
  })
  const m = mini.data
  const profile = m?.profile
  const turns = convo.data?.turns ?? []
  const inUse = Object.entries(m?.permissions ?? {}).filter(([, on]) => on)

  return (
    <div className="grid h-full grid-cols-1 gap-3 min-[900px]:grid-cols-[1fr_300px]">
      <section aria-label="Conversation" className="flex min-h-0 flex-col rounded-tile border border-line bg-surface p-[var(--pad-tile)]">
        <header className="mb-4 flex items-center gap-4">
          <BotSprite sprite={profile?.sprite} accent={profile?.accent ?? '#d77757'} state={botState(m?.phase)} size={64} label={profile?.name ?? 'Mini'} />
          <div className="min-w-0">
            <h2 className="text-title font-semibold">{profile?.name ?? 'Mini'}</h2>
            <p className="truncate text-small text-ink-2">{!m ? 'Loading' : !m.running ? 'Not running' : m.detail || 'Resting'}</p>
          </div>
        </header>
        <ol className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto">
          {turns.length === 0 && <li className="text-small text-ink-3">Ask Mini something below. Replies appear here as they are written.</li>}
          {turns.map(t => (
            <li key={t.id} className="flex flex-col gap-1">
              <p className="self-end rounded-panel bg-surface-2 px-3 py-2 text-body break-words">{t.text}</p>
              {t.reply !== undefined ? (
                <p className={`whitespace-pre-wrap break-words text-body ${t.isError ? 'text-danger' : ''}`}>{t.reply}</p>
              ) : (
                <p className="text-small text-ink-3">Mini is working on it</p>
              )}
              {t.partial && <p className="text-micro text-ink-3">Still writing</p>}
            </li>
          ))}
        </ol>
        <form
          className="mt-4 flex gap-2"
          onSubmit={e => {
            e.preventDefault()
            if (text.trim()) ask.mutate(text.trim())
          }}
        >
          <input
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder={m?.running ? 'Ask Mini' : 'Start Mini to ask it something'}
            aria-label="Ask Mini"
            disabled={!m?.running}
            className="h-9 min-w-0 flex-1 rounded-control border border-line bg-surface-2 px-3 text-body placeholder:text-ink-3 focus:border-line-strong focus:outline-none disabled:opacity-60"
          />
          <Button variant="primary" type="submit" disabled={!m?.running || !text.trim() || ask.isPending}>
            Send
          </Button>
        </form>
        {note && <p className="mt-2 text-small text-danger">{note}</p>}
      </section>

      <aside className="flex flex-col gap-3">
        <section aria-label="Now" className="rounded-tile border border-line bg-surface p-[var(--pad-tile)]">
          <h2 className="mb-3 text-head font-semibold">Now</h2>
          <div className="flex flex-col gap-2">
            <Dot tone={m?.running ? 'ok' : 'muted'} label={m?.running ? 'Running' : 'Not running'} />
            {inUse.map(([k]) => (
              <Dot key={k} tone="warn" label={`${PERMISSION_NAMES[k] ?? k}: on`} />
            ))}
            <Button size="sm" className="mt-1 self-start" onClick={() => startStop.mutate(!m?.running)} disabled={!m || startStop.isPending}>
              {m?.running ? 'Stop the bot' : 'Start Mini'}
            </Button>
          </div>
        </section>
        {m?.card && (
          <section aria-label="Waiting in the bot" className="rounded-tile border border-warn/50 bg-surface p-[var(--pad-tile)]">
            <h2 className="mb-2 text-head font-semibold">Waiting in the bot</h2>
            <p className="mb-2 text-body break-words">{m.card.text}</p>
            <p className="text-small text-warn">A question is open on the bot. Answer it there.</p>
          </section>
        )}
      </aside>
    </div>
  )
}
