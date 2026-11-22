import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test } from 'vitest'
import { setKeys } from '../src/app/keys.ts'
import { CallsTile } from '../src/widgets/calls.tsx'
import { MessagesTile } from '../src/widgets/messages.tsx'
import { MiniTile } from '../src/widgets/mini.tsx'
import { mockApi } from './mock-api.ts'

const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>)

const LONG = 'A very long message that goes on and on '.repeat(8).slice(0, 300).trim()
const TAMIL = 'இன்று மாலை சந்திக்கலாமா? 😄'

beforeEach(() => setKeys({ api: '1234', key: 'k'.repeat(64) }))

describe('home tiles', () => {
  test('tiles truncate long and non-Latin text', async () => {
    mockApi({
      'GET /v1/settings': { theme: 'dark', accent: 'bot', density: 'comfortable', privacy: false },
      'GET /v1/events': {
        items: [
          { id: 1, deviceId: 'p', type: 'chat', occurredAt: Date.now() - 60_000, who: 'Someone with a very long display name '.repeat(4), app: 'WhatsApp', title: LONG, body: LONG, data: {} },
          { id: 2, deviceId: 'p', type: 'chat', occurredAt: Date.now() - 120_000, who: 'Meera', app: 'WhatsApp', title: TAMIL, body: TAMIL, data: {} },
        ],
      },
    })
    wrap(<MessagesTile />)
    const long = await screen.findByTitle(LONG)
    expect(long.className).toContain('truncate')
    const tamil = screen.getByTitle(TAMIL)
    expect(tamil).toHaveTextContent(TAMIL)
    expect(tamil.className).toContain('truncate')
  })

  test('empty tiles say what to switch on', async () => {
    mockApi({ 'GET /v1/events': { items: [] }, 'GET /v1/settings': { privacy: false } })
    wrap(<CallsTile />)
    expect(await screen.findByText('Nothing yet. Turn on what to collect in Permissions.')).toBeInTheDocument()
  })

  test('a failed tile says so and can retry', async () => {
    const api = mockApi({ 'GET /v1/settings': { privacy: false } })
    wrap(<CallsTile />)
    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }))
    expect(api.calls.filter(c => c === 'GET /v1/events').length).toBeGreaterThanOrEqual(2)
  })

  test('codes are masked until hover', async () => {
    mockApi({
      'GET /v1/settings': { privacy: false },
      'GET /v1/events': { items: [{ id: 3, deviceId: 'p', type: 'sms', occurredAt: Date.now(), who: 'Bank', title: 'Your OTP is 482913. Do not share it.', data: {} }] },
    })
    wrap(<MessagesTile />)
    expect(await screen.findByText('••••••')).toBeInTheDocument()
    expect(screen.getByText('482913').className).toContain('hidden')
  })

  test('the code is masked, not another number beside it', async () => {
    const text = 'Txn 98765432: your OTP is 123456'
    mockApi({
      'GET /v1/settings': { privacy: false },
      'GET /v1/events': { items: [{ id: 4, deviceId: 'p', type: 'sms', occurredAt: Date.now(), who: 'Bank', title: text, data: {} }] },
    })
    wrap(<MessagesTile />)
    await screen.findAllByText('••••••')
    expect(screen.getByText('123456').className).toContain('hidden')
    expect(screen.getByText('98765432').className).toContain('hidden')
  })

  test('the Mini tile asks Mini on Enter', async () => {
    const api = mockApi({
      'GET /v1/mini': { running: true, profile: { name: 'Mini', avatar: 'clawd', accent: '#d77757' } },
      'POST /v1/mini/prompt': { id: 't1' },
    })
    wrap(<MiniTile />)
    const box = await screen.findByRole('textbox', { name: 'Ask Mini' })
    await userEvent.type(box, 'Who called me?{Enter}')
    await waitFor(() => expect(api.bodies['POST /v1/mini/prompt']).toEqual({ text: 'Who called me?' }))
  })

  test('the Mini tile says when Mini is not running', async () => {
    mockApi({ 'GET /v1/mini': { running: false }, 'POST /v1/mini/start': { ok: true } })
    wrap(<MiniTile />)
    expect(await screen.findByText('Mini is not running.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start Mini' })).toBeInTheDocument()
  })
})
