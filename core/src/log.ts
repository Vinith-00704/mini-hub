// Logs say what happened, never what was in it: message and mail text, names, arguments, tokens and keys are hidden.

import pino, { type DestinationStream, type Logger as Pino } from 'pino'

export const REDACT = [
  'body',
  'text',
  'who',
  'args',
  'token',
  'key',
  'dbKey',
  'personKey',
  '*.body',
  '*.text',
  '*.who',
  '*.args',
  '*.token',
  '*.key',
  '*.dbKey',
  '*.personKey',
  'req.headers["x-hub-ui"]',
  'req.headers.authorization',
]

export function createLogger(dest?: DestinationStream): Pino {
  return pino({ level: 'info', base: null, redact: { paths: REDACT, censor: '[hidden]' } }, dest ?? pino.destination(2))
}
