import { describe, expect, test } from 'vitest'
import { accentFor, contrast, readable, textOn } from '../src/design/color.ts'

const SURFACES = { dark: '#16181b', light: '#ffffff' }
const NAMED = ['claude', 'blue', 'green', 'pink', 'orange', 'purple']

describe('colour', () => {
  test('textOn picks black on the default accent and white on a dark accent', () => {
    expect(textOn('#d77757')).toBe('#000000')
    expect(textOn('#8e5cf0')).toBe('#000000')
    expect(textOn('#3a2a8c')).toBe('#ffffff')
  })

  test('accentFor follows the bot, a named colour or a hex', () => {
    expect(accentFor('bot', '#ef5da8')).toBe('#ef5da8')
    expect(accentFor('bot', undefined)).toBe('#d77757')
    expect(accentFor('blue', '#ef5da8')).toBe('#4c8dff')
    expect(accentFor('#123ABC', '#ef5da8')).toBe('#123abc')
  })

  test('readable meets 4.5 on both surfaces for every named accent', () => {
    for (const name of NAMED) {
      const hex = accentFor(name, undefined)
      for (const surface of Object.values(SURFACES)) expect(contrast(readable(hex, surface), surface)).toBeGreaterThanOrEqual(4.5)
    }
  })

  test('readable leaves an accent that already reads well alone', () => {
    expect(readable('#000000', '#ffffff')).toBe('#000000')
  })
})
