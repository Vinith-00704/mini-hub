import { afterEach, describe, expect, test, vi } from 'vitest'
import { keysFromShell } from '../src/app/keys.ts'

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
})

describe('keys from the shell', () => {
  test('keys come from the shell inside Tauri', async () => {
    ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}
    const invoke = vi.fn(async () => ({ api: '4567', key: 'b'.repeat(64) }))
    expect(await keysFromShell(invoke)).toEqual({ api: '4567', key: 'b'.repeat(64) })
    expect(invoke).toHaveBeenCalledWith('hub_keys')
  })

  test('outside Tauri nothing is asked', async () => {
    const invoke = vi.fn()
    expect(await keysFromShell(invoke)).toBeNull()
    expect(invoke).not.toHaveBeenCalled()
  })

  test("the shell's message comes through when the core could not start", async () => {
    ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}
    const invoke = vi.fn(async () => {
      throw "The hub's data could not be opened."
    })
    await expect(keysFromShell(invoke)).rejects.toThrow("The hub's data could not be opened.")
  })
})
