import { describe, expect, test } from 'vitest'
import { ERROR_CODES, eventScope, newEventSchema, SCOPES } from '../src/index.ts'

describe('scopes', () => {
  test('every scope in 03 exists with its kind', () => {
    expect(Object.keys(SCOPES).length).toBe(18)
    expect(SCOPES['phone.reply'].kind).toBe('important')
    expect(SCOPES['mail.change'].kind).toBe('act')
    expect(SCOPES['mail.send'].kind).toBe('important')
    expect(SCOPES['pc.power'].kind).toBe('act')
    expect(SCOPES['phone.calls.read'].collectable).toBe(true)
    expect(SCOPES['phone.control'].collectable).toBe(false)
    expect(SCOPES['home.control'].perDevice).toBe(false)
  })
})

describe('events', () => {
  test('event types map to their scopes', () => {
    expect(eventScope('sms')).toBe('phone.messages.read')
    expect(eventScope('chat')).toBe('phone.messages.read')
    expect(eventScope('call')).toBe('phone.calls.read')
    expect(eventScope('mail')).toBe('mail.read')
    expect(eventScope('mini_action')).toBe('own')
    expect(eventScope('system')).toBe('person')
    expect(eventScope('voice_request')).toBe('person')
    expect(eventScope('device_state', 'phone')).toBe('phone.usage.read')
    expect(eventScope('device_state', 'pc')).toBe('pc.status.read')
    expect(eventScope('device_state', 'light')).toBe('home.read')
  })

  test('the event schema refuses oversize text', () => {
    const base = { type: 'sms', occurredAt: 1 }
    expect(newEventSchema.safeParse({ ...base, title: 'x'.repeat(300) }).success).toBe(true)
    expect(newEventSchema.safeParse({ ...base, title: 'x'.repeat(301) }).success).toBe(false)
    expect(newEventSchema.safeParse({ ...base, who: 'x'.repeat(201) }).success).toBe(false)
    expect(newEventSchema.safeParse({ ...base, body: 'x'.repeat(20001) }).success).toBe(false)
    expect(newEventSchema.safeParse({ ...base, type: 'nonsense' }).success).toBe(false)
  })

  test('error codes are the agreed set', () => {
    expect([...ERROR_CODES].sort()).toEqual(['bad-request', 'conflict', 'decided', 'expired', 'forbidden', 'no-network', 'not-allowed', 'not-found', 'offline', 'stopped', 'timeout', 'too-large', 'unauthorized', 'unavailable'])
  })
})
