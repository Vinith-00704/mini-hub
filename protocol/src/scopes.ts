// The things that can be granted (docs/03-security-and-permissions.md > Scopes). Change that page and this list together.

export type Risk = 'read' | 'act' | 'important'
export type GrantState = 'off' | 'ask' | 'on'

export type ScopeDef = {
  /** Plain words for the dashboard. */
  label: string
  /** The scope's usual risk. Each action's own risk is fixed by its connector. */
  kind: Risk
  connector: string
  /** Decided per device (a phone, a mail account) rather than once for the whole connector. */
  perDevice: boolean
  /** Has a "collect" switch: data of this kind is recorded only when it is on. */
  collectable: boolean
}

const scope = (label: string, kind: Risk, connector: string, perDevice: boolean, collectable: boolean): ScopeDef => ({
  label,
  kind,
  connector,
  perDevice,
  collectable,
})

export const SCOPES = {
  'phone.calls.read': scope('Call history', 'read', 'android', true, true),
  'phone.messages.read': scope('Messages (SMS and chat apps)', 'read', 'android', true, true),
  'phone.notifications.read': scope('Other notifications', 'read', 'android', true, true),
  'phone.usage.read': scope('Battery and app use', 'read', 'android', true, true),
  'phone.location.read': scope('Location', 'read', 'android', true, true),
  'phone.screen.read': scope('Reading the screen', 'read', 'android', true, false),
  'phone.control': scope('Controlling the phone', 'act', 'android', true, false),
  'phone.reply': scope('Sending replies, SMS and calls', 'important', 'android', true, false),
  'mail.read': scope('Reading mail', 'read', 'mail', true, true),
  'mail.change': scope('Marking, drafting and archiving mail', 'act', 'mail', true, false),
  'mail.send': scope('Sending mail', 'important', 'mail', true, false),
  'pc.status.read': scope("This PC's state", 'read', 'pc', true, true),
  'pc.power': scope('Locking, sleeping and shutting down this PC', 'act', 'pc', true, false),
  'home.read': scope('The state of home devices', 'read', 'home', false, true),
  'home.control': scope('Switching home devices', 'act', 'home', false, false),
  'echo.speak': scope('Making the Echo Dot speak', 'act', 'home', false, false),
  'voice.alexa.ask': scope('Questions through the Echo Dot', 'read', 'alexa', false, false),
  'voice.alexa.private': scope('Private details in spoken answers', 'read', 'alexa', false, false),
} as const satisfies Record<string, ScopeDef>

export type ScopeId = keyof typeof SCOPES

export const isScope = (value: unknown): value is ScopeId => typeof value === 'string' && Object.hasOwn(SCOPES, value)

// Scopes that exist only on the phone (docs/03 > Scopes). They are not in SCOPES on purpose: the hub offers no grant,
// no Collect switch and no "From my PC" list for them, and the phone keeps them out of its state frame's lists. They
// can still appear as the `scope` of a `mini_action` the phone records, so a check of that field accepts them.
export const PHONE_ONLY_SCOPES = {
  'phone.status.read': { label: 'Phone status', kind: 'read' },
} as const satisfies Record<string, { label: string; kind: Risk }>

export type PhoneOnlyScopeId = keyof typeof PHONE_ONLY_SCOPES

export const isPhoneOnlyScope = (value: unknown): value is PhoneOnlyScopeId => typeof value === 'string' && Object.hasOwn(PHONE_ONLY_SCOPES, value)

/** A hub scope or one only the phone has: for checking what a phone reports about its own actions. */
export const isAnyScope = (value: unknown): value is ScopeId | PhoneOnlyScopeId => isScope(value) || isPhoneOnlyScope(value)
