// INT-001 T-H1: AES-256-GCM envelope for the outbound webhook signing
// secret (`integration_settings.outbound_secret_enc`). The key comes from
// `INT001_SECRET_KEY` (32 raw bytes, base64 or hex encoded) -- never
// derived from a per-row value, so a stolen row alone is not enough to
// decrypt it.
//
// Ciphertext format: `v1:<base64 iv>:<base64 authTag>:<base64 ciphertext>`.
// The `v1:` prefix is a forward-compatible discriminator -- a future
// re-key/algorithm change adds a `v2:` branch rather than breaking every
// row written under v1.

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const KEY_LENGTH = 32
const PREFIX = 'v1'

function loadKey(): Buffer {
  const raw = process.env.INT001_SECRET_KEY
  if (!raw) {
    throw new Error('secret-box: INT001_SECRET_KEY is not set')
  }
  const key = raw.includes('-') || raw.length === 44
    ? Buffer.from(raw, 'base64')
    : /^[0-9a-fA-F]+$/.test(raw)
      ? Buffer.from(raw, 'hex')
      : Buffer.from(raw, 'base64')
  if (key.length !== KEY_LENGTH) {
    throw new Error(
      `secret-box: INT001_SECRET_KEY must decode to ${KEY_LENGTH} bytes, got ${key.length}`
    )
  }
  return key
}

export function encryptSecret(plaintext: string): string {
  const key = loadKey()
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return [
    PREFIX,
    iv.toString('base64'),
    authTag.toString('base64'),
    ciphertext.toString('base64'),
  ].join(':')
}

export function decryptSecret(envelope: string): string {
  const parts = envelope.split(':')
  if (parts.length !== 4 || parts[0] !== PREFIX) {
    throw new Error('secret-box: unrecognised envelope format')
  }
  const [, ivB64, authTagB64, ciphertextB64] = parts
  const key = loadKey()
  const iv = Buffer.from(ivB64, 'base64')
  const authTag = Buffer.from(authTagB64, 'base64')
  const ciphertext = Buffer.from(ciphertextB64, 'base64')
  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  return plaintext.toString('utf8')
}

/** Last 4 characters of the plaintext secret, for display (T-H1: the outbound
 * secret is masked + last-4-only, never re-displayed in full). */
export function secretLast4(plaintext: string): string {
  return plaintext.slice(-4)
}
