// Mini on the Home board: the bot and what it is doing, its last reply as a terminal line, a box to ask it, and
// starting or stopping the bot.

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { post } from '../app/api.ts'
import { useConversation, useMini } from '../app/queries.ts'
import { BotSprite } from '../components/BotSprite.tsx'
import { Button, Cursor, PixelBot, Tag, Window } from '../components/look/index.ts'
import { botState } from '../features/frame/look.ts'

export function MiniTile() {
  const client = useQueryClient()
  const mini = useMini()
  const turns = useConversation().data?.turns ?? []
  const [text, setText] = useState('')
  const [note, setNote] = useState('')
  const refresh = () => void client.invalidateQueries({ queryKey: ['mini'] })
  const ask = useMutation({
    mutationFn: (t: string) => post('/v1/mini/prompt', { text: t }),
    onSuccess: () => (setText(''), setNote(''), refresh()),
    onError: (e: Error) => setNote(e.message),
  })
  const start = useMutation({ mutationFn: () => post('/v1/mini/start'), onSuccess: refresh, onError: (e: Error) => setNote(e.message) })
  const stop = useMutation({ mutationFn: () => post('/v1/mini/stop'), onSuccess: refresh, onError: (e: Error) => setNote(e.message) })
  const m = mini.data
  const profile = m?.profile
  const last = turns.at(-1)
  const phase = botState(m?.phase)
  const look = !m?.running ? 'asleep' : phase === 'thinking' || phase === 'working' ? 'thinking' : 'idle'
  const custom = Boolean(profile?.sprite)

  return (
    <Window
      title={`${profile?.name ?? 'Mini'} · this PC`}
      tag={m?.running ? <Tag tone="ok" pill>● {m.card ? 'Needs you' : 'Ready'}</Tag> : <Tag tone="muted" pill>Off</Tag>}
      state={mini.isPending ? 'loading' : mini.isError ? 'error' : 'ready'}
      {...(mini.error ? { error: mini.error.message } : {})}
      onRetry={() => void mini.refetch()}
    >
      <div className="flex items-center gap-3">
        <span className="flex h-16 w-16 shrink-0 items-center justify-center border-2 border-ink bg-card-bar">
          {custom ? <BotSprite sprite={profile?.sprite} accent={profile?.accent ?? '#d97757'} state={phase} size={44} label={profile?.name ?? 'Mini'} /> : <PixelBot state={look} size={44} label={profile?.name ?? 'Mini'} />}
        </span>
        <div className="min-w-0">
          {!m?.running ? (
            <>
              <p className="text-[20px] font-black uppercase">Asleep</p>
              <p className="text-small text-ink-2">Mini is not running.</p>
            </>
          ) : m.card ? (
            <>
              <p className="text-[20px] font-black text-warn uppercase">Needs you</p>
              <p className="text-small text-ink-2">A question is open on the bot. Answer it there.</p>
            </>
          ) : (
            <>
              <p className="text-[20px] font-black uppercase">{look === 'thinking' ? 'Thinking' : 'Idle'}</p>
              <p className="truncate text-small text-ink-2">{m.detail || 'Listening for your prompt.'}</p>
            </>
          )}
        </div>
      </div>

      {last && (
        <div className="tabular border-[1.6px] border-dashed border-ink-3 px-3 py-2 text-[12px] leading-relaxed">
          <div className="truncate">
            <span className="text-accent-ink">&gt;</span> {last.text}
          </div>
          <div className="line-clamp-2 text-ink-2">
            {last.reply ?? ''}
            {(last.reply === undefined || last.partial) && <Cursor />}
          </div>
        </div>
      )}

      {m?.running && (
        <form
          className="flex gap-2"
          onSubmit={e => {
            e.preventDefault()
            if (text.trim()) ask.mutate(text.trim())
          }}
        >
          <label className="lk-field flex-1">
            <b>&gt;</b>
            <input value={text} onChange={e => (setText(e.target.value), setNote(''))} placeholder="ask mini…" aria-label="Ask Mini" />
          </label>
          <Button type="submit" variant="primary" busy={ask.isPending} disabled={!text.trim()}>
            Ask
          </Button>
        </form>
      )}
      {note && (
        <p role="status" className="text-micro text-danger">
          {note}
        </p>
      )}
      <div className="mt-auto flex gap-2">
        {m?.running ? (
          <>
            <a href="#/mini" className="lk-btn sm">
              Conversation
            </a>
            <Button size="sm" variant="danger" busy={stop.isPending} onClick={() => stop.mutate()}>
              Stop the bot
            </Button>
          </>
        ) : (
          <Button size="sm" variant="primary" busy={start.isPending} onClick={() => start.mutate()}>
            Start Mini
          </Button>
        )}
      </div>
    </Window>
  )
}
