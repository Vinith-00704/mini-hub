// The link to the Mini Bot running on this PC (docs/06-connectors.md > mini). It reads the bot's state, sends it
// prompts the owner typed in the dashboard, and turns what Mini did on the PC into events. It never answers the
// bot's own cards and never touches the bot's permissions: those stay the owner's click in the bot.

import { spawn as nodeSpawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { NewEvent } from '@minihub/protocol'
import type { Connector, Ctx } from './types.ts'

export const DEFAULT_ACCENT = '#d77757'
const NAMED_ACCENTS: Record<string, string> = {
  claude: DEFAULT_ACCENT,
  blue: '#4c8dff',
  green: '#2fbf71',
  pink: '#ef5da8',
  orange: '#f58f29',
  purple: '#8e5cf0',
}

export const accentHex = (accent: unknown): string => {
  if (typeof accent === 'string' && /^#[0-9a-f]{6}$/i.test(accent)) return accent.toLowerCase()
  return (typeof accent === 'string' && NAMED_ACCENTS[accent]) || DEFAULT_ACCENT
}

export type MiniProfile = { name: string; avatar: string; accent: string; sprite?: unknown }

export type MiniState = {
  running: boolean
  profile?: MiniProfile
  phase?: string
  detail?: string
  /** A question waiting in the bot. Shown in the dashboard as "answer it in the bot", never answered from here. */
  card?: { kind: string; text: string }
  permissions?: Record<string, boolean>
  assistant?: { status?: string }
  error?: string
}

export type Turn = { id: string; text: string; reply?: string; partial: boolean; isError: boolean; at: number }

export type MiniLink = {
  snapshot(): MiniState
  refresh(): Promise<MiniState>
  prompt(text: string): Promise<string>
  conversation(): Turn[]
  startBot(): Promise<void>
  stopBot(): Promise<void>
  stopControl(): Promise<void>
  syncLog(emit: (e: NewEvent) => void): Promise<void>
  onChange(fn: () => void): () => void
}

type SpawnFn = (cmd: string, args: string[]) => void

type Options = {
  botHome: string
  fetch?: typeof fetch
  spawn?: SpawnFn
  now?: () => number
  pollMs?: { busy: number; idle: number }
  /** Where the last control-log entry taken in is remembered, so a restart does not take them in again. */
  mark?: { get(): string; set(value: string): void }
}

const TIMEOUT_MS = 3000
const MAX_TURNS = 50
// A reply not finished in this long is closed as unfinished.
const TURN_GIVE_UP_MS = 10 * 60 * 1000
const UNFINISHED = 'Mini did not finish this reply.'

type LogEntry = { at: string; kind: string; task?: string; action?: string; what?: string; why?: string }

/** One line for what Mini did. Typed text is never included. */
const describeEntry = (e: LogEntry): { title: string; outcome: string } | null => {
  switch (e.kind) {
    case 'start':
      return { title: `Started computer control: ${e.task ?? ''}`.trim(), outcome: 'done' }
    case 'act':
      return { title: `${e.action ?? 'acted on'} ${e.what ?? ''}`.trim(), outcome: 'done' }
    case 'refused':
      return { title: `Refused: ${e.action ?? ''} ${e.what ?? ''}`.trim(), outcome: 'refused' }
    case 'denied':
      return { title: `Not allowed: ${e.task ?? ''}`.trim(), outcome: 'refused' }
    case 'read':
      return { title: `Read the page "${e.what ?? ''}"`, outcome: 'done' }
    case 'looked':
      return { title: 'Looked at the screen', outcome: 'done' }
    case 'end':
      return { title: `Finished: ${e.task ?? ''}`.trim(), outcome: 'done' }
    default:
      return null
  }
}

const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

export function miniConnector(opts: Options): Connector & MiniLink {
  const doFetch = opts.fetch ?? fetch
  const now = opts.now ?? Date.now
  const poll = opts.pollMs ?? { busy: 300, idle: 2000 }
  const spawn: SpawnFn =
    opts.spawn ??
    ((cmd, args) => nodeSpawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref())

  let state: MiniState = { running: false }
  let turns: Turn[] = []
  let memoryMark = ''
  const mark = opts.mark ?? { get: () => memoryMark, set: (v: string) => void (memoryMark = v) }
  let timer: NodeJS.Timeout | null = null
  let ctx: Ctx | null = null
  const listeners = new Set<() => void>()

  const info = async (): Promise<{ port: number; token: string } | null> => {
    try {
      const raw = JSON.parse(await readFile(join(opts.botHome, 'runtime.json'), 'utf8')) as { port?: unknown; token?: unknown }
      return typeof raw.port === 'number' && typeof raw.token === 'string' ? { port: raw.port, token: raw.token } : null
    } catch {
      return null
    }
  }

  const call = async <T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> => {
    const where = await info()
    if (!where) throw new Error('Mini is not running.')
    const res = await doFetch(`http://127.0.0.1:${where.port}${path}`, {
      method,
      headers: { authorization: `Bearer ${where.token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) throw new Error(`Mini answered ${res.status}.`)
    return (await res.json()) as T
  }

  const changed = (): void => {
    for (const fn of listeners) fn()
  }

  const read = (raw: Record<string, any>): MiniState => {
    const config = raw.config ?? {}
    const active = (config.profiles ?? []).find((p: { id?: string }) => p.id === config.activeProfileId) ?? config.profiles?.[0]
    const permissions = Object.fromEntries(Object.entries(raw.permissions ?? {}).map(([k, v]) => [k, (v as { granted?: boolean })?.granted === true]))
    const next: MiniState = { running: raw.running === true, permissions }
    if (active)
      next.profile = {
        name: String(active.name ?? 'Mini'),
        avatar: String(active.avatar ?? 'clawd'),
        accent: accentHex(active.appearance?.accent),
        ...(active.sprite ? { sprite: active.sprite } : {}),
      }
    if (raw.activity?.phase) next.phase = String(raw.activity.phase)
    if (raw.activity?.detail) next.detail = String(raw.activity.detail)
    if (raw.card) next.card = { kind: String(raw.card.kind), text: String(raw.card.text ?? '') }
    if (raw.assistant?.status) next.assistant = { status: String(raw.assistant.status) }
    const preview = raw.activity?.preview
    const previewId = preview && typeof preview.id === 'string' ? (preview.id as string) : null
    if (previewId) {
      const turn = turns.find(t => t.id === previewId)
      if (turn) {
        turn.reply = String(preview.text ?? '')
        turn.partial = preview.partial === true
        turn.isError = preview.isError === true
      }
    }
    // The bot clears its reply when a prompt is queued, so a reply for another prompt means ours will not come.
    closeOpen(t => (previewId !== null && t.id !== previewId) || now() - t.at > TURN_GIVE_UP_MS)
    return next
  }

  const closeOpen = (when: (t: Turn) => boolean): void => {
    for (const t of turns)
      if ((t.reply === undefined || t.partial) && when(t)) {
        t.reply = t.reply || UNFINISHED
        t.partial = false
        t.isError = true
      }
  }

  const refresh = async (): Promise<MiniState> => {
    const before = JSON.stringify([state, turns])
    try {
      state = read(await call<Record<string, unknown>>('GET', '/v1/state'))
    } catch {
      state = { running: false }
    }
    if (!state.running) closeOpen(() => true)
    if (JSON.stringify([state, turns]) !== before) changed()
    return state
  }

  const busy = (): boolean => turns.some(t => t.reply === undefined || t.partial)

  const loop = (): void => {
    timer = setTimeout(
      () =>
        void refresh()
          .then(() => (ctx && state.running ? link.syncLog(e => ctx?.emit({ ...e, deviceId: 'hub' })) : undefined))
          .catch(() => {})
          .finally(() => {
            if (timer) loop()
          }),
      busy() ? poll.busy : poll.idle,
    )
    timer.unref()
  }

  const link: MiniLink = {
    snapshot: () => state,
    refresh,
    async prompt(text) {
      const clean = text.trim()
      if (!clean) throw new Error('Type something to ask Mini.')
      // The runtime keeps "hub" as an ordinary typed prompt until it learns the source (docs/09 C).
      const { id } = await call<{ id: string }>('POST', '/v1/prompts', { text: clean, source: 'hub' })
      turns = [...turns, { id, text: clean, partial: false, isError: false, at: now() }].slice(-MAX_TURNS)
      changed()
      return id
    },
    conversation: () => turns.map(t => ({ ...t })),
    async startBot() {
      // The bot writes its launcher only once it may start with the PC; without it there is nothing to start from here.
      const launcher = join(opts.botHome, 'start-mini.mjs')
      if (!existsSync(launcher))
        throw new Error('Mini cannot be started from here yet. Start it in Claude Code with /mini-bot start, or turn on "Start with my PC" in the bot.')
      spawn(process.execPath, [launcher])
    },
    async stopBot() {
      await call('POST', '/v1/shutdown', {})
    },
    async stopControl() {
      await call('POST', '/v1/computer/stop', { reason: 'Stopped from Mini Hub' })
    },
    async syncLog(emit) {
      const { entries } = await call<{ entries?: LogEntry[] }>('GET', '/v1/computer/log')
      // Each entry is placed by its time and its place among entries with the same time, so none is lost or taken twice.
      const [markAt = '', markN = '-1'] = mark.get().split('|')
      let last = mark.get()
      const seen = new Map<string, number>()
      for (const e of entries ?? []) {
        if (typeof e.at !== 'string') continue
        const n = seen.get(e.at) ?? 0
        seen.set(e.at, n + 1)
        if (e.at < markAt || (e.at === markAt && n <= Number(markN))) continue
        last = `${e.at}|${n}`
        const line = describeEntry(e)
        if (!line) continue
        emit({ type: 'mini_action', occurredAt: Date.parse(e.at) || now(), title: clip(line.title, 300), data: { tool: 'computer', kind: e.kind, outcome: line.outcome, on: 'pc' } })
      }
      if (last !== mark.get()) mark.set(last)
    },
    onChange(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
  }

  return {
    ...link,
    manifest: { id: 'mini', name: 'Mini', kind: 'service', icon: 'bot', scopes: [], eventTypes: ['mini_action'], widgets: ['mini', 'mini-activity'], multiple: false },
    async start(c) {
      ctx = c
      await refresh()
      loop()
    },
    async stop() {
      if (timer) clearTimeout(timer)
      timer = null
      ctx = null
    },
    health: () => (state.running ? { state: 'ok' } : { state: 'down', note: 'Mini is not running.' }),
    actions: {},
  }
}
