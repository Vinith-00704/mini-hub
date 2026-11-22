// The hub's one database: a SQLCipher file whose key the shell keeps in Windows Credential Manager.

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3-multiple-ciphers'

export type Store = Database.Database

export class StoreError extends Error {}

const MIGRATIONS = fileURLToPath(new URL('./migrations/', import.meta.url))

/**
 * Opens (or creates) the encrypted database and brings its schema up to date. A wrong key or a damaged file is an
 * error, never a reason to start a fresh database over it.
 */
export function openStore(file: string, key: string): Store {
  if (!/^[0-9a-f]{64}$/.test(key)) throw new StoreError('The database key must be 64 hex characters.')
  const db = new Database(file)
  try {
    db.pragma("cipher='sqlcipher'")
    db.pragma(`key="x'${key}'"`)
    db.prepare('SELECT count(*) FROM sqlite_master').get()
  } catch {
    db.close()
    throw new StoreError("The hub's data could not be opened. The key does not match, or the file is damaged.")
  }
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  migrate(db)
  return db
}

function migrate(db: Store): void {
  db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
  const current = Number(getMeta(db, 'schema') ?? '0')
  const files = readdirSync(MIGRATIONS)
    .filter(f => /^\d{3}-.+\.sql$/.test(f))
    .sort()
  for (const f of files) {
    const n = Number(f.slice(0, 3))
    if (n <= current) continue
    const sql = readFileSync(join(MIGRATIONS, f), 'utf8').replace('CREATE TABLE meta ', 'CREATE TABLE IF NOT EXISTS meta ')
    db.transaction(() => {
      db.exec(sql)
      setMeta(db, 'schema', String(n))
    })()
  }
}

export function getMeta(db: Store, key: string): string | undefined {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value
}

export function setMeta(db: Store, key: string, value: string): void {
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(key, value)
}

export function getSetting<T>(db: Store, key: string, fallback: T): T {
  const row = db.prepare('SELECT value_json FROM settings WHERE key = ?').get(key) as { value_json: string } | undefined
  if (!row) return fallback
  try {
    return JSON.parse(row.value_json) as T
  } catch {
    return fallback
  }
}

export function setSetting(db: Store, key: string, value: unknown): void {
  db.prepare('INSERT INTO settings (key, value_json) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json').run(
    key,
    JSON.stringify(value),
  )
}
