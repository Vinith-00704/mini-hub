// The hub's own certificate for the device link (docs/03 > Keys and secrets). Made once, kept in the encrypted
// database, so it survives restarts: a phone pins the hash of its public key at pairing.
// Built with Node's own crypto: an ECDSA P-256 key and a minimal self-signed X.509 v3 certificate in DER.

import { createHash, createPublicKey, generateKeyPairSync, randomBytes, sign, X509Certificate } from 'node:crypto'
import { getMeta, setMeta, type Store } from '../store/db.ts'

export type HubCert = { certPem: string; keyPem: string; fp: string }

/** The hex SHA-256 of the certificate's public key (SubjectPublicKeyInfo, DER): what a phone pins. */
export const spkiHash = (certPem: string): string =>
  createHash('sha256').update(createPublicKey(certPem).export({ type: 'spki', format: 'der' })).digest('hex')

// --- just enough DER ---
const len = (n: number): Buffer => {
  if (n < 0x80) return Buffer.from([n])
  const bytes: number[] = []
  for (let v = n; v > 0; v >>= 8) bytes.unshift(v & 0xff)
  return Buffer.from([0x80 | bytes.length, ...bytes])
}
const tlv = (tag: number, body: Buffer): Buffer => Buffer.concat([Buffer.from([tag]), len(body.length), body])
const seq = (...parts: Buffer[]): Buffer => tlv(0x30, Buffer.concat(parts))
const oid = (dotted: string): Buffer => {
  const [a, b, ...rest] = dotted.split('.').map(Number) as number[]
  const out = [a! * 40 + b!]
  for (const n of rest) {
    const chunk: number[] = [n & 0x7f]
    for (let v = n >> 7; v > 0; v >>= 7) chunk.unshift(0x80 | (v & 0x7f))
    out.push(...chunk)
  }
  return tlv(0x06, Buffer.from(out))
}
const int = (b: Buffer): Buffer => tlv(0x02, b[0]! & 0x80 ? Buffer.concat([Buffer.from([0]), b]) : b)
const utf8 = (s: string): Buffer => tlv(0x0c, Buffer.from(s, 'utf8'))
/** A validity date: UTCTime through 2049 and GeneralizedTime after, as RFC 5280 asks (strict parsers refuse otherwise). */
export const derTime = (d: Date): Buffer => {
  const p = (n: number) => String(n).padStart(2, '0')
  const rest = `${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
  const year = d.getUTCFullYear()
  return year < 2050 ? tlv(0x17, Buffer.from(`${p(year % 100)}${rest}`, 'ascii')) : tlv(0x18, Buffer.from(`${year}${rest}`, 'ascii'))
}
const name = (cn: string): Buffer => seq(tlv(0x31, seq(oid('2.5.4.3'), utf8(cn))))
const ECDSA_SHA256 = seq(oid('1.2.840.10045.4.3.2'))

export function makeCert(commonName = 'Mini Hub', now = new Date()): HubCert {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const spki = publicKey.export({ type: 'spki', format: 'der' })
  const serial = randomBytes(16)
  // Positive and minimal in DER: the first byte is neither zero nor has its top bit set.
  serial[0] = (serial[0]! & 0x7f) | 0x40
  const notBefore = new Date(now.getTime() - 24 * 3600_000)
  const notAfter = new Date(notBefore.getTime() + 10 * 365 * 24 * 3600_000)
  // Extensions: basicConstraints (not a CA, critical) and keyUsage digitalSignature (critical).
  const basic = seq(oid('2.5.29.19'), tlv(0x01, Buffer.from([0xff])), tlv(0x04, seq()))
  const usage = seq(oid('2.5.29.15'), tlv(0x01, Buffer.from([0xff])), tlv(0x04, tlv(0x03, Buffer.from([0x07, 0x80]))))
  const tbs = seq(
    tlv(0xa0, int(Buffer.from([2]))), // v3
    int(serial),
    ECDSA_SHA256,
    name(commonName),
    seq(derTime(notBefore), derTime(notAfter)),
    name(commonName),
    spki,
    tlv(0xa3, seq(basic, usage)),
  )
  const signature = sign('sha256', tbs, privateKey) // DER-encoded ECDSA signature
  const der = seq(tbs, ECDSA_SHA256, tlv(0x03, Buffer.concat([Buffer.from([0]), signature])))
  const certPem = `-----BEGIN CERTIFICATE-----\n${der.toString('base64').replace(/(.{64})/g, '$1\n').trim()}\n-----END CERTIFICATE-----\n`
  const keyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string
  if (!new X509Certificate(certPem).verify(publicKey)) throw new Error('the new certificate does not verify')
  return { certPem, keyPem, fp: spkiHash(certPem) }
}

export async function loadOrMakeCert(db: Store): Promise<HubCert> {
  const saved = getMeta(db, 'link:cert')
  if (saved) return JSON.parse(saved) as HubCert
  const made = makeCert()
  setMeta(db, 'link:cert', JSON.stringify(made))
  return made
}
