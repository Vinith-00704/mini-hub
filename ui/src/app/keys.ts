// The person key and the core's port. In development the launcher puts them in the address's #fragment (never sent
// to a server); they are moved into memory at once and the address is cleaned. The shell will hand them over its
// own way, through setKeys.

export type Keys = { api: string; key: string }

let current: Keys | null = null

export function setKeys(keys: Keys | null): void {
  current = keys
}

export function readKeys(): Keys | null {
  if (current) return current
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const api = hash.get('api')
  const key = hash.get('k')
  if (api && /^\d+$/.test(api) && key && /^[0-9a-f]{64}$/.test(key)) {
    current = { api, key }
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
  }
  return current
}
