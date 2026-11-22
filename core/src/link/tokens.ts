// Device tokens: 256 random bits, given to the device once; the hub keeps only the SHA-256 (docs/03).

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { Store } from '../store/db.ts'

const hash = (token: string): Buffer => createHash('sha256').update(token, 'utf8').digest()

export class Tokens {
  private db: Store
  constructor(db: Store) {
    this.db = db
  }

  issue(deviceId: string): string {
    const token = randomBytes(32).toString('base64url')
    this.db.prepare('UPDATE devices SET token_hash = ? WHERE id = ?').run(hash(token).toString('hex'), deviceId)
    return token
  }

  check(deviceId: string, token: string): boolean {
    const row = this.db.prepare('SELECT token_hash FROM devices WHERE id = ? AND removed_at IS NULL').get(deviceId) as { token_hash: string | null } | undefined
    if (!row?.token_hash) return false
    return timingSafeEqual(Buffer.from(row.token_hash, 'hex'), hash(token))
  }

  revoke(deviceId: string): void {
    this.db.prepare('UPDATE devices SET token_hash = NULL WHERE id = ?').run(deviceId)
  }

  /** Phones that can link now. */
  paired(): string[] {
    return (this.db.prepare('SELECT id FROM devices WHERE token_hash IS NOT NULL AND removed_at IS NULL').all() as Array<{ id: string }>).map(r => r.id)
  }
}
