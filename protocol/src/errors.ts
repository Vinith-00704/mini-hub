// Every error the hub's API returns has one of these codes, which a program can test, and a sentence a person can read.

export const ERROR_CODES = [
  'unauthorized',
  'forbidden',
  'not-allowed',
  'stopped',
  'not-found',
  'bad-request',
  'too-large',
  'expired',
  'decided',
  'unavailable',
] as const

export type ErrorCode = (typeof ERROR_CODES)[number]

export type ApiError = { error: string; code: ErrorCode; scope?: string }
