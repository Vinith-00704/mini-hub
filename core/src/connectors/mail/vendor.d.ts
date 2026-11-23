// html-to-text ships no types; the one function the mail connector uses.
declare module 'html-to-text' {
  export function convert(html: string, options?: object): string
}
