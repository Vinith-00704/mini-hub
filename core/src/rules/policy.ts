// The one place that says whether something runs, waits for the owner, or is refused
// (docs/03-security-and-permissions.md > Risk, > A turn started by voice).

import type { ErrorCode, GrantState, Risk } from '@minihub/protocol'

export type PolicyInput = {
  caller: 'person' | 'agent'
  /** The agent is acting in a turn started by someone speaking to the Echo Dot. */
  voice?: boolean
  risk: Risk
  grant: GrantState
  voiceSafe?: boolean
  voicePrivate?: boolean
  /** A read of calls, messages, mail or notifications. */
  isPrivateRead?: boolean
  stopped: boolean
}

export type Decision = { kind: 'run' } | { kind: 'ask' } | { kind: 'refuse'; code: 'not-allowed' | 'stopped' }

const RUN: Decision = { kind: 'run' }
const ASK: Decision = { kind: 'ask' }
const NOT_ALLOWED: Decision = { kind: 'refuse', code: 'not-allowed' }

export function decide(i: PolicyInput): Decision {
  if (i.caller === 'person') return RUN
  if (i.stopped) return { kind: 'refuse', code: 'stopped' }
  if (i.grant === 'off') return NOT_ALLOWED
  if (i.voice) {
    // Anyone in the room can speak: no approvals, nothing important, only what the owner marked safe by voice.
    if (i.grant !== 'on' || i.risk === 'important') return NOT_ALLOWED
    if (i.risk === 'act' && !i.voiceSafe) return NOT_ALLOWED
    if (i.risk === 'read' && i.isPrivateRead && !i.voicePrivate) return NOT_ALLOWED
    return RUN
  }
  if (i.grant === 'ask' || i.risk === 'important') return ASK
  return RUN
}

/** An error the API turns into its status and `{ error, code }` body. */
export class ApiFailure extends Error {
  status: number
  code: ErrorCode
  scope?: string

  constructor(status: number, code: ErrorCode, message: string, scope?: string) {
    super(message)
    this.status = status
    this.code = code
    if (scope !== undefined) this.scope = scope
  }
}
