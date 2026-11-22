import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test } from 'vitest'
import { setKeys } from '../src/app/keys.ts'
import { Activity } from '../src/features/activity/Activity.tsx'
import { MiniScreen } from '../src/features/mini/MiniScreen.tsx'
import { Permissions } from '../src/features/permissions/Permissions.tsx'
import { Settings } from '../src/features/settings/Settings.tsx'
import { mockApi } from './mock-api.ts'

const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>)

beforeEach(() => setKeys({ api: '1234', key: 'k'.repeat(64) }))

const row = (over: Record<string, unknown>) => ({ target: 'phone-test', targetName: 'Test phone', collect: false, mini: 'off', voiceSafe: false, collectable: true, ...over })

describe('Mini screen', () => {
  test('the Mini screen never shows Yes or No for a bot card', async () => {
    mockApi({
      'GET /v1/mini': { running: true, profile: { name: 'Mini', avatar: 'clawd', accent: '#d77757' }, card: { kind: 'trust-full', text: 'Turn on full access?' } },
      'GET /v1/mini/conversation': { turns: [] },
    })
    wrap(<MiniScreen />)
    expect(await screen.findByText('A question is open on the bot. Answer it there.')).toBeInTheDocument()
    expect(screen.getByText('Turn on full access?')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^(yes|no|turn it on|allow)$/i })).toBeNull()
  })

  test('shows the conversation with the reply as it is written', async () => {
    mockApi({
      'GET /v1/mini': { running: true, profile: { name: 'Mini', avatar: 'clawd', accent: '#d77757' } },
      'GET /v1/mini/conversation': { turns: [{ id: 't1', text: 'Who called?', reply: 'Asha called at 9', partial: true, isError: false, at: 1 }] },
    })
    wrap(<MiniScreen />)
    expect(await screen.findByText('Who called?')).toBeInTheDocument()
    expect(screen.getByText('Asha called at 9')).toBeInTheDocument()
    expect(screen.getByText(/writing/i)).toBeInTheDocument()
  })
})

describe('Permissions', () => {
  test('turning a scope to on calls PUT /v1/grants/:target/:scope', async () => {
    const api = mockApi({
      'GET /v1/grants': { items: [row({ scope: 'phone.calls.read', label: 'Call history', kind: 'read', collect: true })] },
      'GET /v1/mini': { running: true, permissions: { screen: true, microphone: false } },
      'PUT /v1/grants/phone-test/phone.calls.read': {},
    })
    wrap(<Permissions />)
    await userEvent.click(await screen.findByRole('radio', { name: 'Mini may use Call history: On' }))
    await waitFor(() => expect(api.bodies['PUT /v1/grants/phone-test/phone.calls.read']).toEqual({ mini: 'on' }))
    expect(await screen.findByText(/Mini will be able to read your call history/i)).toBeInTheDocument()
  })

  test('important scopes say always asks first', async () => {
    mockApi({
      'GET /v1/grants': { items: [row({ scope: 'phone.reply', label: 'Sending replies, SMS and calls', kind: 'important', collectable: false })] },
      'GET /v1/mini': { running: false },
    })
    wrap(<Permissions />)
    expect(await screen.findByText('Always asks first')).toBeInTheDocument()
    expect(screen.queryByRole('switch')).toBeNull()
  })

  test("the PC's own permissions are shown read-only, to change in the bot", async () => {
    mockApi({ 'GET /v1/grants': { items: [] }, 'GET /v1/mini': { running: true, permissions: { screen: true, microphone: false } } })
    wrap(<Permissions />)
    expect(await screen.findByText(/change these in the bot/i)).toBeInTheDocument()
    expect(await screen.findByText('Screen: on')).toBeInTheDocument()
  })
})

describe('Activity', () => {
  test('the activity banner shows when the chain is broken', async () => {
    mockApi({
      'GET /v1/audit': { items: [{ id: 2, at: Date.now(), caller: 'agent', action: 'act', target: 'pc.lock', outcome: 'refused', data: {} }] },
      'GET /v1/audit/check': { ok: false, brokenAt: 2 },
    })
    wrap(<Activity />)
    expect(await screen.findByText(/has been changed by hand/i)).toBeInTheDocument()
    expect(screen.getByText('refused: switched off')).toBeInTheDocument()
  })
})

describe('Settings', () => {
  test('changing theme sets data-theme', async () => {
    const api = mockApi({
      'GET /v1/settings': { theme: 'dark', accent: 'bot', density: 'comfortable', privacy: false, dataDir: 'C:\\data', version: '0.1.0' },
      'PATCH /v1/settings': (body: unknown) => ({ theme: 'dark', accent: 'bot', density: 'comfortable', privacy: false, ...(body as object) }),
    })
    wrap(<Settings />)
    await userEvent.click(await screen.findByRole('radio', { name: 'Theme: Light' }))
    await waitFor(() => expect(api.bodies['PATCH /v1/settings']).toEqual({ theme: 'light' }))
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('light'))
  })
})
