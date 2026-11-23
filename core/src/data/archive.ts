// Backup and restore (docs/04 > What is kept: The backup). A file protected by a passphrase the owner types, so it
// restores on a new PC. It carries events, devices (without tokens), boards and the dashboard's settings; never
// secrets, device tokens, the hub's certificate, switches and grants, approvals or the audit log.
//
// The file: bytes 0-3 "MHX1", 4-19 a random salt, 20-31 a random IV, then the ciphertext, then the 16-byte GCM tag.
// The key is scrypt(passphrase, salt); AES-256-GCM with bytes 0-31 as additional data. The plaintext is gzip of
// UTF-8 NDJSON: a header line, then settings, devices, boards and events, one object per line.

import { createCipheriv, createDecipheriv, randomBytes, scrypt } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { open, rename, rm } from 'node:fs/promises'
import { Readable, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { StringDecoder } from 'node:string_decoder'
import { createGunzip, createGzip } from 'node:zlib'
import { z } from 'zod'
import { EVENT_TYPES, MAX_BODY, MAX_TITLE, MAX_WHO, type Board } from '@minihub/protocol'
import { uiSettingsSchema } from '../api/routes/settings.ts'
import { checkLayout, MAX_BOARDS } from '../boards.ts'
import { ApiFailure } from '../rules/policy.ts'
import { getMeta, setMeta, setSetting, type Store } from '../store/db.ts'
import { retentionSchema } from './retention.ts'

const MAGIC = Buffer.from('MHX1', 'ascii')
const SALT_BYTES = 16
const IV_BYTES = 12
const HEAD_BYTES = MAGIC.length + SALT_BYTES + IV_BYTES
const TAG_BYTES = 16
const FORMAT = 'minihub-export'
const VERSION = 1
/** Rows read from the database at a time, and rows applied to a transaction on import. */
const PAGE = 500
const SETTING_KEYS = ['ui', 'retention'] as const

const NOT_A_BACKUP = 'This is not a Mini Hub backup.'
const WRONG = 'The passphrase is wrong, or the file is damaged.'
const CHANGED = 'The file changed while it was being read. Import it again.'
const NEWER = 'This backup is from a newer Mini Hub.'

const keyOf = (passphrase: string, salt: Buffer): Promise<Buffer> =>
  new Promise((resolve, reject) =>
    scrypt(Buffer.from(passphrase, 'utf8'), salt, 32, { N: 65536, r: 8, p: 1, maxmem: 134217728 }, (error, key) => (error ? reject(error) : resolve(key))),
  )

const line = (o: unknown): string => `${JSON.stringify(o)}\n`

type RawDevice = { id: string; connector_id: string; kind: string; name: string; room: string | null; info_json: string; added_at: number; removed_at: number | null }
type RawEvent = {
  id: number
  device_id: string
  seq: number
  type: string
  occurred_at: number
  received_at: number
  who: string | null
  who_key: string | null
  app: string | null
  title: string | null
  body: string | null
  data_json: string
  seen_at: number | null
}

const parsed = (json: string): unknown => {
  try {
    return JSON.parse(json)
  } catch {
    return {}
  }
}

/**
 * The lines of a backup. The database is read a page at a time, each page in one go, so the whole database is never
 * in memory and the connection is never held busy between two pages (the hub goes on working during an export).
 */
function* backupLines(db: Store, hubVersion: string, written: { events: number; boards: number; devices: number }): Generator<Buffer> {
  const count = (table: string): number => (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n
  // The counts when the export began. Events that arrive during it can make what is written differ; the route
  // answers with what was written, and nothing reads these back.
  const counts = { events: count('events'), boards: count('boards'), devices: count('devices') }
  let out = line({ kind: 'header', format: FORMAT, version: VERSION, hubVersion, exportedAt: Date.now(), counts })
  for (const key of SETTING_KEYS) {
    const row = db.prepare('SELECT value_json FROM settings WHERE key = ?').get(key) as { value_json: string } | undefined
    if (row) out += line({ kind: 'setting', key, value: parsed(row.value_json) })
  }
  yield Buffer.from(out)

  // Every device, removed ones too (their events name them); never its token or its state. A mail account's info has
  // no password: the password is only ever in the secrets table, which is never read here.
  const devices = db.prepare('SELECT id, connector_id, kind, name, room, info_json, added_at, removed_at FROM devices WHERE id > ? ORDER BY id LIMIT ?')
  for (let after = ''; ; ) {
    const rows = devices.all(after, PAGE) as RawDevice[]
    if (!rows.length) break
    // The device sits in its own object: its `kind` (phone, pc, mail-account) is not the line's.
    const device = (d: RawDevice) => ({ id: d.id, connectorId: d.connector_id, kind: d.kind, name: d.name, room: d.room, info: parsed(d.info_json), addedAt: d.added_at, removedAt: d.removed_at })
    yield Buffer.from(rows.map(d => line({ kind: 'device', device: device(d) })).join(''))
    written.devices += rows.length
    after = rows.at(-1)!.id
  }

  const boards = db.prepare('SELECT id, name, position, layout_json FROM boards ORDER BY position, id').all() as Array<{ id: string; name: string; position: number; layout_json: string }>
  if (boards.length) yield Buffer.from(boards.map(b => line({ kind: 'board', id: b.id, name: b.name, position: b.position, layout: parsed(b.layout_json) })).join(''))
  written.boards = boards.length

  const events = db.prepare('SELECT * FROM events WHERE id > ? ORDER BY id LIMIT ?')
  for (let after = 0; ; ) {
    const rows = events.all(after, PAGE) as RawEvent[]
    if (!rows.length) break
    yield Buffer.from(
      rows
        .map(e =>
          line({
            kind: 'event',
            deviceId: e.device_id,
            seq: e.seq,
            type: e.type,
            occurredAt: e.occurred_at,
            receivedAt: e.received_at,
            who: e.who,
            whoKey: e.who_key,
            app: e.app,
            title: e.title,
            body: e.body,
            data: parsed(e.data_json),
            seenAt: e.seen_at,
          }),
        )
        .join(''),
    )
    written.events += rows.length
    after = rows.at(-1)!.id
  }
}

/** Writes a backup to `path`: first to a file beside it, renamed over `path` only once it is complete. */
export async function exportTo(db: Store, path: string, passphrase: string, hubVersion: string): Promise<{ events: number; boards: number; devices: number }> {
  const salt = randomBytes(SALT_BYTES)
  const iv = randomBytes(IV_BYTES)
  const head = Buffer.concat([MAGIC, salt, iv])
  const cipher = createCipheriv('aes-256-gcm', await keyOf(passphrase, salt), iv)
  cipher.setAAD(head)
  const written = { events: 0, boards: 0, devices: 0 }
  const tmp = `${path}.${process.pid}.tmp`
  try {
    await pipeline(
      Readable.from(backupLines(db, hubVersion, written)),
      createGzip(),
      cipher,
      async function* (ciphertext: AsyncIterable<Buffer>) {
        yield head
        for await (const chunk of ciphertext) yield chunk
        yield cipher.getAuthTag()
      },
      createWriteStream(tmp, { mode: 0o600 }),
    )
    await rename(tmp, path)
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => {})
    throw error
  }
  return written
}

const text = (max: number) => z.string().max(max).nullable()
const whole = z.number().int().nonnegative()

const headerLine = z.object({ kind: z.literal('header'), format: z.literal(FORMAT), version: z.number().int().min(1) })
const settingLine = z.object({ key: z.enum(SETTING_KEYS), value: z.unknown() })
const deviceLine = z.object({
  device: z.object({
    id: z.string().min(1).max(100),
    connectorId: z.string().min(1).max(40),
    kind: z.string().min(1).max(40),
    name: z.string().min(1).max(200),
    room: text(60).optional(),
    info: z.record(z.string(), z.unknown()),
    addedAt: whole,
  }),
})
const boardLine = z.object({ id: z.string().regex(/^[a-z0-9-]{1,40}$/), name: z.string().trim().min(1).max(40), layout: z.unknown() })
const eventLine = z.object({
  deviceId: z.string().min(1).max(100),
  seq: z.number().int().positive(),
  type: z.enum(EVENT_TYPES),
  occurredAt: whole,
  receivedAt: whole,
  who: text(MAX_WHO),
  whoKey: text(MAX_WHO),
  app: text(200),
  title: text(MAX_TITLE),
  body: text(MAX_BODY),
  data: z.record(z.string(), z.unknown()),
  seenAt: whole.nullable(),
})

export type ImportResult = { events: { added: number; skipped: number }; boards: number; devices: number; boardsLeftOut: number }

/** A refusal whose cause the route writes to the log: the error's code or name only, never its message. */
export class ArchiveFailure extends ApiFailure {
  logCode: string

  constructor(status: number, message: string, logCode: string) {
    super(status, status >= 500 ? 'unavailable' : 'bad-request', message)
    this.logCode = logCode
  }
}

/** GCM's own words when the tag does not match: wrong passphrase, or the bytes are not the ones sealed. */
const AUTH_FAILED = 'Unsupported state or unable to authenticate data'

type Cause = 'auth' | 'file' | 'full' | 'db' | 'format'

const causeOf = (error: unknown): { cause: Cause; code: string } => {
  const e = (typeof error === 'object' && error !== null ? error : {}) as { code?: unknown; name?: unknown; message?: unknown; syscall?: unknown }
  const code = typeof e.code === 'string' ? e.code : typeof e.name === 'string' ? e.name : 'unknown'
  if (e.name === 'SqliteError') return { cause: code === 'SQLITE_FULL' ? 'full' : 'db', code }
  if (typeof e.syscall === 'string' || /^E[A-Z]+$/.test(code)) return { cause: 'file', code }
  if (e.message === AUTH_FAILED) return { cause: 'auth', code: 'auth' }
  return { cause: 'format', code }
}

const UNREADABLE = 'The file could not be read.'
const NO_SPACE = 'There is not enough space to restore.'
const NOT_DONE = 'The restore did not work. Nothing was changed.'
const PARTLY = 'The restore stopped partway, and some of it could not be taken back. Import it again.'
/** A line longer than this is not one a backup has (the largest is one event, about 20 KB of text). */
const MAX_LINE = 1024 * 1024

/** What a restore changed, so a restore that fails can take it all back. */
type Journal = {
  events: number[]
  devices: string[]
  boardsAdded: string[]
  /** A board's name and layout before the restore replaced it. */
  boardsBefore: Map<string, { name: string; layout_json: string }>
  /** A setting's stored value before the restore replaced it; null when there was none. */
  settingsBefore: Map<string, string | null>
}

const emptyJournal = (): Journal => ({ events: [], devices: [], boardsAdded: [], boardsBefore: new Map(), settingsBefore: new Map() })

/** Applies the lines of a backup, a transaction of 500 rows at a time. Nothing is applied before a valid header. */
class Restore {
  result: ImportResult = { events: { added: 0, skipped: 0 }, boards: 0, devices: 0, boardsLeftOut: 0 }
  #db: Store
  #now = Date.now()
  #header = false
  #batch: Array<(j: Journal) => void> = []
  #known: Set<string>
  #boards: number
  /** The highest number seen per device in the batch being applied. */
  #seqs = new Map<string, number>()
  /** What committed batches changed. A batch's own changes join it only once its transaction has committed. */
  #journal = emptyJournal()

  constructor(db: Store) {
    this.#db = db
    this.#known = new Set((db.prepare('SELECT id FROM devices').all() as Array<{ id: string }>).map(r => r.id))
    this.#boards = (db.prepare('SELECT count(*) AS n FROM boards').get() as { n: number }).n
  }

  line(raw: string): void {
    if (raw.length > MAX_LINE) throw new ApiFailure(400, 'bad-request', NOT_A_BACKUP)
    if (!raw.trim()) return
    let o: Record<string, unknown>
    try {
      o = JSON.parse(raw) as Record<string, unknown>
    } catch {
      if (!this.#header) throw new ApiFailure(400, 'bad-request', NOT_A_BACKUP)
      return
    }
    if (!this.#header) {
      const h = headerLine.safeParse(o)
      if (!h.success) throw new ApiFailure(400, 'bad-request', NOT_A_BACKUP)
      if (h.data.version > VERSION) throw new ApiFailure(400, 'bad-request', NEWER)
      this.#header = true
      return
    }
    // A line this version does not understand is passed over; an event passed over is counted as skipped.
    if (o.kind === 'setting') this.#setting(o)
    else if (o.kind === 'device') this.#device(o)
    else if (o.kind === 'board') this.#board(o)
    else if (o.kind === 'event') this.#event(o)
    if (this.#batch.length >= PAGE) this.flush()
  }

  /** Applies what is waiting, and moves each device's numbering past what came in, in the same transaction. */
  flush(): void {
    if (!this.#batch.length) return
    const batch = this.#batch
    this.#batch = []
    const known = new Set(this.#known)
    const boards = this.#boards
    const result = structuredClone(this.result)
    const step = emptyJournal()
    try {
      this.#db.transaction(() => {
        for (const apply of batch) apply(step)
        for (const [device, seq] of this.#seqs) {
          const key = device === 'hub' ? 'hubSeq' : `seq:${device}`
          if (Number(getMeta(this.#db, key) ?? '0') < seq) setMeta(this.#db, key, String(seq))
        }
      })()
    } catch (error) {
      // The transaction took its own rows back; what was counted for it goes too.
      ;[this.#known, this.#boards, this.result] = [known, boards, result]
      throw error
    } finally {
      this.#seqs.clear()
    }
    const j = this.#journal
    j.events.push(...step.events)
    j.devices.push(...step.devices)
    j.boardsAdded.push(...step.boardsAdded)
    for (const [k, v] of step.boardsBefore) if (!j.boardsBefore.has(k)) j.boardsBefore.set(k, v)
    for (const [k, v] of step.settingsBefore) if (!j.settingsBefore.has(k)) j.settingsBefore.set(k, v)
  }

  /**
   * Takes back everything committed batches changed: the events and devices added, the boards and settings as they
   * were. Each device's numbering stays moved on: a higher number never makes a new event look like a repeat.
   * False when something could not be taken back.
   */
  undo(): boolean {
    const j = this.#journal
    const db = this.#db
    try {
      const event = db.prepare('DELETE FROM events WHERE id = ?')
      for (let i = 0; i < j.events.length; i += PAGE * 10) {
        const ids = j.events.slice(i, i + PAGE * 10)
        db.transaction(() => ids.forEach(id => event.run(id)))()
      }
      db.transaction(() => {
        const device = db.prepare('DELETE FROM devices WHERE id = ? AND NOT EXISTS (SELECT 1 FROM events WHERE device_id = ?)')
        for (const id of j.devices) device.run(id, id)
        for (const id of j.boardsAdded) db.prepare('DELETE FROM boards WHERE id = ?').run(id)
        for (const [id, b] of j.boardsBefore) db.prepare('UPDATE boards SET name = ?, layout_json = ? WHERE id = ?').run(b.name, b.layout_json, id)
        for (const [key, value] of j.settingsBefore)
          if (value === null) db.prepare('DELETE FROM settings WHERE key = ?').run(key)
          else db.prepare('UPDATE settings SET value_json = ? WHERE key = ?').run(value, key)
      })()
      this.#journal = emptyJournal()
      return true
    } catch {
      return false
    }
  }

  get started(): boolean {
    return this.#header
  }

  #setting(o: Record<string, unknown>): void {
    const s = settingLine.safeParse(o)
    if (!s.success) return
    const value = (s.data.key === 'ui' ? uiSettingsSchema.partial() : retentionSchema.partial()).safeParse(s.data.value)
    if (!value.success) return
    const key = s.data.key
    this.#batch.push(j => {
      if (!this.#journal.settingsBefore.has(key) && !j.settingsBefore.has(key)) {
        const row = this.#db.prepare('SELECT value_json FROM settings WHERE key = ?').get(key) as { value_json: string } | undefined
        j.settingsBefore.set(key, row?.value_json ?? null)
      }
      setSetting(this.#db, key, value.data)
    })
  }

  #device(o: Record<string, unknown>): void {
    const d = deviceLine.safeParse(o)
    if (!d.success) return
    const dev = d.data.device
    this.#batch.push(j => {
      // This PC is the hub's own; a device the hub already has is left as it is.
      if (dev.id === 'pc' || this.#known.has(dev.id)) return
      // A restored device is marked removed (a phone pairs again, a mail account is added again: no secrets came),
      // except the hub itself, which holds the hub's own notes.
      this.#db
        .prepare('INSERT INTO devices (id, connector_id, kind, name, room, info_json, state_json, added_at, removed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(dev.id, dev.connectorId, dev.kind, dev.name, dev.room ?? null, JSON.stringify(dev.info), '{}', dev.addedAt, dev.id === 'hub' && dev.connectorId === 'hub' ? null : this.#now)
      this.#known.add(dev.id)
      j.devices.push(dev.id)
      this.result.devices++
    })
  }

  #board(o: Record<string, unknown>): void {
    const b = boardLine.safeParse(o)
    let layout: Board['layout'] | undefined
    try {
      if (b.success) layout = checkLayout(b.data.layout)
    } catch {}
    if (!b.success || !layout) return void this.result.boardsLeftOut++
    const { id, name } = b.data
    const json = JSON.stringify(layout)
    this.#batch.push(j => {
      const before = this.#db.prepare('SELECT name, layout_json FROM boards WHERE id = ?').get(id) as { name: string; layout_json: string } | undefined
      if (before) {
        if (!this.#journal.boardsBefore.has(id) && !j.boardsBefore.has(id) && !this.#journal.boardsAdded.includes(id) && !j.boardsAdded.includes(id))
          j.boardsBefore.set(id, before)
        this.#db.prepare('UPDATE boards SET name = ?, layout_json = ? WHERE id = ?').run(name, json, id)
        return void this.result.boards++
      }
      if (this.#boards >= MAX_BOARDS) return void this.result.boardsLeftOut++
      this.#db.prepare('INSERT INTO boards (id, name, position, layout_json) VALUES (?, ?, ?, ?)').run(id, name, this.#boards++, json)
      j.boardsAdded.push(id)
      this.result.boards++
    })
  }

  #event(o: Record<string, unknown>): void {
    const e = eventLine.safeParse(o)
    if (!e.success) return void this.result.events.skipped++
    const ev = e.data
    this.#batch.push(j => {
      if (!this.#known.has(ev.deviceId)) return void this.result.events.skipped++
      // Written directly: the owner's own restore. The search index fills itself from the table's triggers.
      const info = this.#db
        .prepare(
          'INSERT OR IGNORE INTO events (device_id, seq, type, occurred_at, received_at, who, who_key, app, title, body, data_json, seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(ev.deviceId, ev.seq, ev.type, ev.occurredAt, ev.receivedAt, ev.who, ev.whoKey, ev.app, ev.title, ev.body, JSON.stringify(ev.data), ev.seenAt)
      if (info.changes > 0) {
        this.result.events.added++
        j.events.push(Number(info.lastInsertRowid))
      } else this.result.events.skipped++
      if ((this.#seqs.get(ev.deviceId) ?? 0) < ev.seq) this.#seqs.set(ev.deviceId, ev.seq)
    })
  }
}

type Frame = { head: Buffer; tag: Buffer; size: number }

/** The file's first 32 bytes and its tag. Anything that does not start like a backup is refused here. */
const frameOf = async (path: string): Promise<Frame> => {
  const fh = await open(path, 'r')
  try {
    const size = (await fh.stat()).size
    if (size <= HEAD_BYTES + TAG_BYTES) throw new ApiFailure(400, 'bad-request', NOT_A_BACKUP)
    const head = Buffer.alloc(HEAD_BYTES)
    const tag = Buffer.alloc(TAG_BYTES)
    await fh.read(head, 0, HEAD_BYTES, 0)
    await fh.read(tag, 0, TAG_BYTES, size - TAG_BYTES)
    if (!head.subarray(0, MAGIC.length).equals(MAGIC)) throw new ApiFailure(400, 'bad-request', NOT_A_BACKUP)
    return { head, tag, size }
  } finally {
    await fh.close()
  }
}

/**
 * Restores a backup. Pass 1 checks the whole file against its tag and writes nothing; pass 2 reads it again and
 * applies it. A restore that fails takes back what it applied. Devices come back removed, every switch stays as it
 * is (off on a new hub), nothing is read as a grant.
 */
export async function importFrom(db: Store, path: string, passphrase: string): Promise<ImportResult> {
  const first = await frameOf(path)
  const key = await keyOf(passphrase, first.head.subarray(MAGIC.length, MAGIC.length + SALT_BYTES))
  const decipher = (f: Frame) => {
    const d = createDecipheriv('aes-256-gcm', key, f.head.subarray(MAGIC.length + SALT_BYTES))
    d.setAAD(f.head)
    d.setAuthTag(f.tag)
    return d
  }
  const ciphertext = (f: Frame) => createReadStream(path, { start: HEAD_BYTES, end: f.size - TAG_BYTES - 1 })

  // Pass 1: the whole file through the decipher, the output thrown away. Only a file that checks out goes further.
  try {
    await pipeline(ciphertext(first), decipher(first), new Writable({ write: (_chunk, _enc, done) => done() }))
  } catch (error) {
    const { cause, code } = causeOf(error)
    if (cause === 'auth') throw new ApiFailure(400, 'bad-request', WRONG)
    throw new ArchiveFailure(500, UNREADABLE, code)
  }

  // Pass 2: the same file again, applied as it is read.
  let again: Frame
  try {
    again = await frameOf(path)
  } catch (error) {
    if (error instanceof ApiFailure) throw new ApiFailure(400, 'bad-request', CHANGED)
    throw new ArchiveFailure(500, UNREADABLE, causeOf(error).code)
  }
  if (again.size !== first.size || !again.head.equals(first.head) || !again.tag.equals(first.tag)) throw new ApiFailure(400, 'bad-request', CHANGED)
  const restore = new Restore(db)
  try {
    await pipeline(ciphertext(again), decipher(again), createGunzip(), async (plain: AsyncIterable<Buffer>) => {
      const utf8 = new StringDecoder('utf8')
      let rest = ''
      for await (const chunk of plain) {
        const parts = (rest + utf8.write(chunk)).split('\n')
        rest = parts.pop() ?? ''
        if (rest.length > MAX_LINE) throw new ApiFailure(400, 'bad-request', NOT_A_BACKUP)
        for (const p of parts) restore.line(p)
      }
      restore.line(rest + utf8.end())
      if (!restore.started) throw new ApiFailure(400, 'bad-request', NOT_A_BACKUP)
      restore.flush()
    })
  } catch (error) {
    const { cause, code } = causeOf(error)
    if (!restore.undo()) throw new ArchiveFailure(500, PARTLY, code)
    if (error instanceof ApiFailure) throw error
    if (cause === 'file') throw new ArchiveFailure(500, UNREADABLE, code)
    if (cause === 'full') throw new ArchiveFailure(500, NO_SPACE, code)
    if (cause === 'db') throw new ArchiveFailure(500, NOT_DONE, code)
    // The tag failed at the end of pass 2, or what came out was not what pass 1 checked: the file changed.
    throw new ArchiveFailure(400, CHANGED, code)
  }
  return restore.result
}
