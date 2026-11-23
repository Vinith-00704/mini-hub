// Connectors' passwords and tokens (docs/03 > Keys and secrets). They live only in the `secrets` table of the encrypted
// database, one row per connector and name, and are never logged, returned by a route or exported.

import type { Store } from '../store/db.ts'
import type { SecretAccess } from './types.ts'

export class Secrets {
  #db: Store

  constructor(db: Store) {
    this.#db = db
  }

  /** One connector's secrets; it cannot reach another's. */
  for(connectorId: string): SecretAccess {
    const db = this.#db
    return {
      get(name) {
        const r = db.prepare('SELECT value FROM secrets WHERE connector_id = ? AND name = ?').get(connectorId, name) as { value: string } | undefined
        return r?.value
      },
      set(name, value) {
        db.prepare('INSERT INTO secrets (connector_id, name, value) VALUES (?, ?, ?) ON CONFLICT (connector_id, name) DO UPDATE SET value = excluded.value').run(
          connectorId,
          name,
          value,
        )
      },
      delete(name) {
        db.prepare('DELETE FROM secrets WHERE connector_id = ? AND name = ?').run(connectorId, name)
      },
    }
  }
}
