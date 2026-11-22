import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { readKeys, setKeys } from '../src/app/keys.ts'
import { ApprovalCards } from '../src/features/frame/ApprovalCards.tsx'
import { TopBar } from '../src/features/frame/TopBar.tsx'
import { mockApi } from './mock-api.ts'

const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>)

beforeEach(() => {
  setKeys({ api: '1234', key: 'k'.repeat(64) })
})

describe('keys', () => {
  test('readKeys takes the key from the fragment and clears it', () => {
    setKeys(null)
    window.history.replaceState(null, '', `/#api=4567&k=${'a'.repeat(64)}`)
    expect(readKeys()).toEqual({ api: '4567', key: 'a'.repeat(64) })
    expect(window.location.hash).toBe('')
    expect(readKeys()).toEqual({ api: '4567', key: 'a'.repeat(64) })
  })

  test('without keys there is nothing to read', () => {
    setKeys(null)
    window.history.replaceState(null, '', '/')
    expect(readKeys()).toBeNull()
  })
})

describe('frame', () => {
  test('Stop is shown and calls /v1/stop', async () => {
    const api = mockApi({ 'GET /v1/state': { stopped: false, approvalsWaiting: 0, devices: [] }, 'POST /v1/stop': { stopped: true } })
    wrap(<TopBar title="Home" />)
    await userEvent.click(screen.getByRole('button', { name: /stop mini/i }))
    await waitFor(() => expect(api.calls).toContain('POST /v1/stop'))
  })

  test('an approval card shows the summary and answers yes', async () => {
    const api = mockApi({
      'GET /v1/approvals': { approvals: [{ id: 'a1', summary: 'Shut down this PC', state: 'waiting', expiresAt: Date.now() + 60_000, risk: 'important', scope: 'pc.power' }] },
      'POST /v1/approvals/a1': { id: 'a1', state: 'yes' },
    })
    wrap(<ApprovalCards />)
    expect(await screen.findByText('Shut down this PC')).toBeInTheDocument()
    expect(screen.getByText(/always asks first/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Yes' }))
    await waitFor(() => expect(api.bodies['POST /v1/approvals/a1']).toEqual({ decision: 'yes' }))
  })
})

vi.mock('../src/app/live.ts', () => ({ useLive: () => {} }))
