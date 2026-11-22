// Five wrong tokens from one address close the link to it for ten minutes (docs/03 > The network).

const LIMIT = 5
const BLOCK_MS = 10 * 60_000

export class Guard {
  #seen = new Map<string, { fails: number; until: number }>()
  private now: () => number
  constructor(now: () => number = Date.now) {
    this.now = now
  }

  allowed(addr: string): boolean {
    const s = this.#seen.get(addr)
    if (!s || s.until === 0) return true
    if (s.until > this.now()) return false
    this.#seen.delete(addr)
    return true
  }

  failed(addr: string): void {
    const s = this.#seen.get(addr) ?? { fails: 0, until: 0 }
    s.fails++
    if (s.fails >= LIMIT) s.until = this.now() + BLOCK_MS
    this.#seen.set(addr, s)
  }

  succeeded(addr: string): void {
    this.#seen.delete(addr)
  }
}
