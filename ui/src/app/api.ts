// Talks to the hub core. Every request carries the person key; every error has a code and a sentence.

import { readKeys } from './keys.ts'

export class ApiFailure extends Error {
  status: number
  code: string
  scope?: string

  constructor(status: number, code: string, message: string, scope?: string) {
    super(message)
    this.status = status
    this.code = code
    if (scope) this.scope = scope
  }
}

export const baseUrl = (): string => {
  const keys = readKeys()
  if (!keys) throw new ApiFailure(0, 'unauthorized', 'Mini Hub was opened without its key. Open it from the tray.')
  return `http://127.0.0.1:${keys.api}`
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const keys = readKeys()
  if (!keys) throw new ApiFailure(0, 'unauthorized', 'Mini Hub was opened without its key. Open it from the tray.')
  let res: Response
  try {
    res = await fetch(`${baseUrl()}${path}`, {
      method: init.method ?? 'GET',
      headers: { 'x-hub-ui': keys.key, ...(init.body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    })
  } catch {
    throw new ApiFailure(0, 'unavailable', 'The hub is not answering. It may be starting, or stopped.')
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string; scope?: string }
  if (!res.ok) throw new ApiFailure(res.status, data.code ?? 'unavailable', data.error ?? 'Something went wrong in the hub.', data.scope)
  return data as T
}

export const post = <T>(path: string, body: unknown = {}) => api<T>(path, { method: 'POST', body })
export const put = <T>(path: string, body: unknown) => api<T>(path, { method: 'PUT', body })
export const patch = <T>(path: string, body: unknown) => api<T>(path, { method: 'PATCH', body })
