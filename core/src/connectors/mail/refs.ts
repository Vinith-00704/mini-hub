// What the mail actions take, and how a message is named (docs/06 > mail). No schema here transforms anything: what an
// approval shows is exactly what is sent or drafted (Global Constraints, RF1).

import { z } from 'zod'

/** A plain ASCII mail address. The same rule for the setup's address and for every recipient. */
export const ADDRESS = /^[^\s@<>(),;:"\[\]]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,63}$/
const ASCII = /^[\x21-\x7e]+$/
/** A local part that goes on the wire as typed: no backslash, no leading, trailing or double dot (those get quoted). */
const UNQUOTED = /^(?!\.)(?!.*\.\.)(?!.*\.@)[^\\]+$/
export const isAddress = (s: string): boolean => s.length <= 254 && ADDRESS.test(s) && ASCII.test(s) && UNQUOTED.test(s)

export const MAX_RECIPIENTS = 20
export const MAX_SUBJECT = 300
export const MAX_TEXT = 20_000
export const SEARCH_LIMIT = 20

const NOT_ADDRESS = 'Each recipient must be a plain mail address such as asha@example.com. Only ASCII addresses work here.'
const address = z.string().max(254, NOT_ADDRESS).regex(ADDRESS, NOT_ADDRESS).regex(ASCII, NOT_ADDRESS).regex(UNQUOTED, NOT_ADDRESS)

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Give dates as YYYY-MM-DD.')
  .refine(s => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s), 'That date does not exist.')

const byEvent = z.strictObject({ event: z.number().int().positive() })
const byPlace = z.strictObject({
  folder: z.string().min(1).max(200).regex(/^[^\x00-\x1f\x7f]+$/),
  uid: z.number().int().positive(),
  uidValidity: z.string().regex(/^\d{1,20}$/),
})

/** A mail event of this account, or a message `search` found. */
export const refSchema = z.union([byEvent, byPlace], { error: 'Name the mail by { event } or by the { folder, uid, uidValidity } that search gave.' })

export type Ref = z.infer<typeof refSchema>
export type Place = z.infer<typeof byPlace>

const compose = z
  .strictObject({
    to: z.array(address).min(1, 'Say who the mail is for.').max(MAX_RECIPIENTS),
    cc: z.array(address).max(MAX_RECIPIENTS).optional(),
    bcc: z.array(address).max(MAX_RECIPIENTS).optional(),
    subject: z.string().max(MAX_SUBJECT, `Keep the subject to ${MAX_SUBJECT} characters.`).refine(s => !/[\r\n\u0085\u2028\u2029]/.test(s), 'The subject must be one line.')
      .refine(s => !/[\x00-\x1f\x7f]/.test(s), 'The subject cannot hold control characters such as tabs.'),
    text: z.string().min(1, 'The mail has no text.').max(MAX_TEXT, `Keep the text to ${MAX_TEXT.toLocaleString('en')} characters.`),
    replyTo: refSchema.optional(),
  })
  .refine(a => a.to.length + (a.cc?.length ?? 0) + (a.bcc?.length ?? 0) <= MAX_RECIPIENTS, `A mail can go to at most ${MAX_RECIPIENTS} people across To, Cc and Bcc.`)

export type Compose = z.infer<typeof compose>

export const ARGS = {
  search: z
    .strictObject({
      text: z.string().min(1).max(200).optional(),
      from: z.string().min(1).max(200).optional(),
      since: day.optional(),
      before: day.optional(),
      folder: z.enum(['inbox', 'all', 'sent']).optional(),
      limit: z.number().int().min(1).max(50).optional(),
    })
    .refine(a => a.text !== undefined || a.from !== undefined || a.since !== undefined, 'Say what to search for: text, from or since.'),
  read: z.strictObject({ ref: refSchema }),
  mark: z
    .strictObject({ ref: refSchema, read: z.boolean().optional(), flagged: z.boolean().optional() })
    .refine(a => a.read !== undefined || a.flagged !== undefined, 'Say whether to mark it read or unread, or flagged or not.'),
  draft: compose,
  archive: z.strictObject({ ref: refSchema }),
  delete: z.strictObject({ ref: refSchema }),
  send: compose,
  check: z.strictObject({}),
}

export type SearchArgs = z.infer<typeof ARGS.search>
export type MarkArgs = z.infer<typeof ARGS.mark>
