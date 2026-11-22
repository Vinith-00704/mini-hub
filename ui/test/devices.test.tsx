import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test } from 'vitest'
import { setKeys } from '../src/app/keys.ts'
import { AddPhone } from '../src/features/devices/AddPhone.tsx'
import { DevicePage } from '../src/features/devices/DevicePage.tsx'
import { Devices } from '../src/features/devices/Devices.tsx'
import { DeviceStatusTile } from '../src/widgets/device-status.tsx'
import { mockApi } from './mock-api.ts'

const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>)

beforeEach(() => {
  setKeys({ api: '1234', key: 'k'.repeat(64) })
  window.location.hash = ''
})

const FP = 'ab'.repeat(32)
const QR = `minihub://pair?v=1&host=192.168.1.20%3A47800&fp=${FP}&code=Zm9vYmFyYmF6cXV4MTIzNA&name=Test+PC`
const started = { qr: QR, address: '192.168.1.20:47800', code: 'Zm9vYmFyYmF6cXV4MTIzNA', expiresAt: Date.now() + 300_000 }

const phone = (over: Record<string, unknown> = {}) => ({
  id: 'phone-1a2b',
  connectorId: 'android',
  kind: 'phone',
  name: 'Test phone',
  info: { model: 'Example Phone 1', appVersion: '0.2.0' },
  state: { online: true, battery: 80, charging: false, network: 'wifi', appVersion: '0.2.0' },
  lastSeenAt: Date.now() - 120_000,
  ...over,
})
const grant = (scope: string, label: string, over: Record<string, unknown> = {}) => ({
  target: 'phone-1a2b',
  targetName: 'Test phone',
  scope,
  label,
  kind: 'read',
  collectable: true,
  collect: false,
  mini: 'off',
  voiceSafe: false,
  ...over,
})

describe('Add device', () => {
  test('Add device shows the QR, then the four words, and Pair confirms', async () => {
    let state: Record<string, unknown> = { state: 'waiting', expiresAt: started.expiresAt }
    const api = mockApi({
      'POST /v1/pairing': started,
      'GET /v1/pairing': () => state,
      'POST /v1/pairing/confirm': { deviceId: 'phone-1a2b' },
    })
    wrap(<AddPhone pollMs={20} />)
    expect(await screen.findByRole('img', { name: 'Pairing code' })).toBeInTheDocument()
    expect(screen.getByText('192.168.1.20:47800')).toBeInTheDocument()
    expect(screen.getByText(/Valid for 5 minutes/)).toBeInTheDocument()
    expect(screen.getByText(/Windows may ask whether Mini Hub can use private networks\. Choose Allow\./)).toBeInTheDocument()

    state = { state: 'check', expiresAt: started.expiresAt, words: ['mountain', 'snail', 'apron', 'duck'], deviceName: 'Test phone' }
    expect(await screen.findByText('Do these match the words on your phone?')).toBeInTheDocument()
    for (const w of ['mountain', 'snail', 'apron', 'duck']) expect(screen.getByText(w)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Pair' }))
    await waitFor(() => expect(api.calls).toContain('POST /v1/pairing/confirm'))
    await waitFor(() => expect(window.location.hash).toBe('#/devices/phone-1a2b?new=1'))
  })

  test('an expired code offers a new one', async () => {
    let n = 0
    const api = mockApi({
      'POST /v1/pairing': () => (n++, started),
      'GET /v1/pairing': { state: 'expired', expiresAt: started.expiresAt },
    })
    wrap(<AddPhone pollMs={20} />)
    expect(await screen.findByText('This code has expired.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Make a new code' }))
    await waitFor(() => expect(n).toBe(2))
    expect(api.calls.filter(c => c === 'POST /v1/pairing')).toHaveLength(2)
  })

  test('Cancel ends the pairing on the hub', async () => {
    const api = mockApi({ 'POST /v1/pairing': started, 'GET /v1/pairing': { state: 'waiting', expiresAt: started.expiresAt }, 'POST /v1/pairing/cancel': { ok: true } })
    wrap(<AddPhone pollMs={20} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(api.calls).toContain('POST /v1/pairing/cancel'))
  })

  test('a PC with no home network says so', async () => {
    mockApi({})
    const { vi } = await import('vitest')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'This PC is not on a home network the phone can reach. Connect to your Wi-Fi and try again.', code: 'no-network' }), { status: 409 })),
    )
    wrap(<AddPhone pollMs={20} />)
    expect(await screen.findByText(/not on a home network/)).toBeInTheDocument()
  })
})

describe('Devices', () => {
  test('the grid starts with Add device and shows each phone with its facts', async () => {
    mockApi({ 'GET /v1/devices': { items: [phone(), { id: 'pc', connectorId: 'pc', kind: 'pc', name: 'This PC', state: {} }] } })
    wrap(<Devices />)
    await screen.findByText('Test phone')
    const cards = screen.getAllByRole('listitem')
    expect(within(cards[0]!).getByRole('button', { name: /Add device/ })).toBeInTheDocument()
    expect(screen.getByText('Test phone')).toBeInTheDocument()
    expect(screen.getByText('80%')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Test phone/ })).toHaveAttribute('href', '#/devices/phone-1a2b')
  })
})

describe('the phone’s page', () => {
  const routes = (over: Record<string, unknown> = {}) => ({
    'GET /v1/devices/phone-1a2b': phone(),
    'GET /v1/grants': {
      items: [
        grant('phone.usage.read', 'Battery and app use', { phone: { mini: 'off', pc: 'ask' } }),
        grant('phone.calls.read', 'Call history', { phone: { mini: 'off', pc: 'off' } }),
        grant('pc.status.read', 'PC status', { target: 'pc', targetName: 'This PC' }),
      ],
    },
    ...over,
  })

  test('the new phone’s page shows every switch off', async () => {
    mockApi(routes())
    wrap(<DevicePage id="phone-1a2b" isNew />)
    expect(await screen.findByText('What should this phone share?')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Collect Battery and app use' })).not.toBeChecked()
    expect(screen.getByRole('switch', { name: 'Collect Call history' })).not.toBeChecked()
    expect(screen.getByRole('radio', { name: 'Mini may use Call history: Off' })).toBeChecked()
    expect(screen.queryByText('PC status')).toBeNull()
  })

  test('the phone’s own lists are shown and cannot be changed here', async () => {
    mockApi(routes())
    wrap(<DevicePage id="phone-1a2b" />)
    const list = await screen.findByRole('region', { name: 'Set on the phone' })
    expect(within(list).getByText('as the phone last reported')).toBeInTheDocument()
    const row = within(list).getByText('Battery and app use').closest('li')!
    expect(within(row).getByText('From my PC: ask')).toBeInTheDocument()
    expect(within(list).queryAllByRole('switch')).toHaveLength(0)
    expect(within(list).queryAllByRole('radio')).toHaveLength(0)
  })

  test('the status shows battery, network, last sync and version', async () => {
    mockApi(routes())
    wrap(<DevicePage id="phone-1a2b" />)
    const status = await screen.findByRole('region', { name: 'Status' })
    expect(within(status).getByText('Online')).toBeInTheDocument()
    expect(within(status).getByText('80%')).toBeInTheDocument()
    expect(within(status).getByText('Wi-Fi')).toBeInTheDocument()
    expect(within(status).getByText('2m ago')).toBeInTheDocument()
    expect(within(status).getByText('0.2.0')).toBeInTheDocument()
  })

  test('Check status now asks the phone and shows the answer', async () => {
    mockApi(
      routes({
        'POST /v1/actions': { ticket: 't-1' },
        'GET /v1/tickets/t-1': { done: true, ok: false, code: 'not-allowed', error: 'From my PC is off for battery and app use.' },
      }),
    )
    wrap(<DevicePage id="phone-1a2b" />)
    await userEvent.click(await screen.findByRole('button', { name: 'Check status now' }))
    expect(await screen.findByText('From my PC is off for battery and app use.')).toBeInTheDocument()
  })

  test('Remove asks, and can delete what it sent', async () => {
    const api = mockApi(routes({ 'DELETE /v1/devices/phone-1a2b': { removed: 'phone-1a2b' } }))
    wrap(<DevicePage id="phone-1a2b" />)
    await userEvent.click(await screen.findByRole('button', { name: 'Remove this phone' }))
    expect(api.calls).not.toContain('DELETE /v1/devices/phone-1a2b')
    expect(screen.getByText(/stops syncing at once/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('checkbox', { name: 'Also delete what it sent' }))
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(api.bodies['DELETE /v1/devices/phone-1a2b']).toEqual({ deleteEvents: true }))
    await waitFor(() => expect(window.location.hash).toBe('#/devices'))
  })
})

describe('the status tile', () => {
  test('the status tile shows battery and last seen, and Not at home when offline', async () => {
    mockApi({
      'GET /v1/state': { version: '0.1.0', stopped: false, today: {}, approvalsWaiting: 0, mini: { running: false, cardWaiting: false }, devices: [phone({ state: { online: false, battery: 41, charging: true } })] },
    })
    wrap(<DeviceStatusTile />)
    expect(await screen.findByText('Not at home')).toBeInTheDocument()
    expect(screen.getByText('41%, charging')).toBeInTheDocument()
    expect(screen.getByText('Last seen 2m ago')).toBeInTheDocument()
  })
})
