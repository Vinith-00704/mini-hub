import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { StartUp } from '../src/features/settings/StartUp.tsx'

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
})

const shell = (answers: Record<string, unknown>) => {
  ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}
  return vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
    const a = answers[cmd]
    return typeof a === 'function' ? (a as (x?: unknown) => unknown)(args) : a
  })
}

describe('start-up settings', () => {
  test('start-up shows the switch inside the shell and calls autostart_set', async () => {
    const invoke = shell({ autostart_get: false, autostart_set: (a: unknown) => (a as { on: boolean }).on, shortcut_status: { key: 'Ctrl+Alt+H', ok: true } })
    render(<StartUp invoke={invoke} />)
    await userEvent.click(await screen.findByRole('switch', { name: 'Start with Windows' }))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('autostart_set', { on: true }))
    expect(await screen.findByText('Ctrl+Alt+H')).toBeInTheDocument()
  })

  test('a taken shortcut is reported, not fatal', async () => {
    const invoke = shell({ autostart_get: true, shortcut_status: { key: 'Ctrl+Alt+H', ok: false } })
    render(<StartUp invoke={invoke} />)
    expect(await screen.findByText(/another program is using it/i)).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Start with Windows' })).toBeChecked()
  })

  test('outside the desktop app it says where these live', async () => {
    const invoke = vi.fn()
    render(<StartUp invoke={invoke} />)
    expect(await screen.findByText(/in the desktop app/i)).toBeInTheDocument()
    expect(invoke).not.toHaveBeenCalled()
  })
})
