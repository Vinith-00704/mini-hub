// Other people's words, and the mail Mini is about to send, are shown as they are, except that characters which change
// how text reads without being seen are made visible: direction overrides and isolates (U+202A-202E, U+2066-2069),
// the direction marks (U+200E, U+200F, U+061C) and zero-width characters (U+200B-200D, U+2060, U+FEFF). Each one shows
// as a marker such as ‹U+202E›. This is for display only; the text itself is never changed.

const HIDDEN = /[‪-‮⁦-⁩‎‏؜​-‍⁠﻿]/g

/** The text with each invisible direction or zero-width character written out as ‹U+XXXX›. */
export const visible = (text: string): string => text.replace(HIDDEN, c => `‹U+${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}›`)

/** The text for display, isolated from what is around it so it cannot reorder its neighbours. */
export function PlainText({ text }: { text: string }) {
  return <bdi>{visible(text)}</bdi>
}
