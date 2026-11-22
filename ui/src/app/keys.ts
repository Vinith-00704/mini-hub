// The person key and the core's port. In development the launcher puts them in the address's #fragment (never sent
// to a server); they are moved into memory at once and the address is cleaned. In the desktop app the shell hands
// them to its own window (keysFromShell).

export type Keys = { api: string; key: string }

type Invoke = (command: string) => Promise<unknown>

const tauriInvoke: Invoke = async command => (await import('@tauri-apps/api/core')).invoke(command)

/**
 * Inside the desktop app, the shell holds the key and the core's port and gives them to its own window only.
 * Null outside the app. When the core could not start, the shell's message is thrown, for the window to show.
 */
export async function keysFromShell(invoke: Invoke = tauriInvoke): Promise<Keys | null> {
  if (!('__TAURI_INTERNALS__' in window)) return null
  try {
    const keys = (await invoke('hub_keys')) as Keys
    current = { api: String(keys.api), key: keys.key }
    return current
  } catch (error) {
    throw new Error(typeof error === 'string' ? error : error instanceof Error ? error.message : 'Mini Hub could not start.')
  }
}

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
