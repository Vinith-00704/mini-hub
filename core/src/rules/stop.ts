// Stop Mini: kept in the database so a restart does not quietly resume. Only a person resumes.

import { getSetting, setSetting, type Store } from '../store/db.ts'

export class StopState {
  #db: Store
  #listeners = new Set<(stopped: boolean) => void>()

  constructor(db: Store) {
    this.#db = db
  }

  get stopped(): boolean {
    return getSetting(this.#db, 'stopped', false)
  }

  stop(): void {
    setSetting(this.#db, 'stopped', true)
    for (const fn of this.#listeners) fn(true)
  }

  resume(): void {
    setSetting(this.#db, 'stopped', false)
    for (const fn of this.#listeners) fn(false)
  }

  onChange(fn: (stopped: boolean) => void): () => void {
    this.#listeners.add(fn)
    return () => this.#listeners.delete(fn)
  }
}
