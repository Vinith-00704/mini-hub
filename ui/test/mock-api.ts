import { vi } from 'vitest'

/** Answers the dashboard's requests from a table, and remembers what was asked. */
export const mockApi = (routes: Record<string, unknown | ((body: unknown) => unknown)>) => {
  const calls: string[] = []
  const bodies: Record<string, unknown> = {}
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = new URL(url).pathname
      const key = `${init?.method ?? 'GET'} ${path}`
      calls.push(key)
      if (init?.body) bodies[key] = JSON.parse(String(init.body))
      const match = routes[key]
      if (match === undefined) return new Response(JSON.stringify({ error: 'missing in test', code: 'not-found' }), { status: 404 })
      const body = typeof match === 'function' ? (match as (b: unknown) => unknown)(bodies[key]) : match
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    }),
  )
  return { calls, bodies }
}
