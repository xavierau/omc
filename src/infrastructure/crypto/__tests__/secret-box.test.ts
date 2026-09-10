import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { randomBytes } from 'node:crypto'
import { decryptSecret, encryptSecret, secretLast4 } from '../secret-box'

describe('secret-box (INT-001 T-H1)', () => {
  const ORIGINAL_KEY = process.env.INT001_SECRET_KEY

  beforeEach(() => {
    process.env.INT001_SECRET_KEY = randomBytes(32).toString('base64')
  })

  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.INT001_SECRET_KEY
    else process.env.INT001_SECRET_KEY = ORIGINAL_KEY
  })

  it('round-trips a secret', () => {
    const plaintext = 'super-secret-webhook-signing-key'
    const envelope = encryptSecret(plaintext)
    expect(decryptSecret(envelope)).toBe(plaintext)
  })

  it('the envelope never contains the plaintext', () => {
    const plaintext = 'super-secret-webhook-signing-key'
    const envelope = encryptSecret(plaintext)
    expect(envelope).not.toContain(plaintext)
  })

  it('is prefixed v1: and has 4 colon-separated parts', () => {
    const envelope = encryptSecret('x')
    const parts = envelope.split(':')
    expect(parts).toHaveLength(4)
    expect(parts[0]).toBe('v1')
  })

  it('two encryptions of the same plaintext produce different ciphertext (random IV)', () => {
    const a = encryptSecret('same-plaintext')
    const b = encryptSecret('same-plaintext')
    expect(a).not.toBe(b)
    expect(decryptSecret(a)).toBe('same-plaintext')
    expect(decryptSecret(b)).toBe('same-plaintext')
  })

  it('fails to decrypt with the wrong key (auth tag mismatch)', () => {
    const envelope = encryptSecret('secret-value')
    process.env.INT001_SECRET_KEY = randomBytes(32).toString('base64')
    expect(() => decryptSecret(envelope)).toThrow()
  })

  it('fails to decrypt a tampered ciphertext', () => {
    const envelope = encryptSecret('secret-value')
    const parts = envelope.split(':')
    const tamperedLastByte = Buffer.from(parts[3], 'base64')
    tamperedLastByte[tamperedLastByte.length - 1] ^= 0xff
    const tampered = [parts[0], parts[1], parts[2], tamperedLastByte.toString('base64')].join(':')
    expect(() => decryptSecret(tampered)).toThrow()
  })

  it('rejects an unrecognised envelope format', () => {
    expect(() => decryptSecret('not-a-valid-envelope')).toThrow(/unrecognised envelope format/)
  })

  it('throws when INT001_SECRET_KEY is not set', () => {
    delete process.env.INT001_SECRET_KEY
    expect(() => encryptSecret('x')).toThrow(/INT001_SECRET_KEY is not set/)
  })

  it('throws when INT001_SECRET_KEY does not decode to 32 bytes', () => {
    process.env.INT001_SECRET_KEY = Buffer.from('too-short').toString('base64')
    expect(() => encryptSecret('x')).toThrow(/must decode to 32 bytes/)
  })
})

describe('secretLast4', () => {
  it('returns the last 4 characters', () => {
    expect(secretLast4('abcdefgh1234')).toBe('1234')
  })

  it('returns the whole string when shorter than 4 characters', () => {
    expect(secretLast4('ab')).toBe('ab')
  })
})
