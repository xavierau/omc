import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import {
  buildInboundBase,
  parseInboundSignatureHeader,
  parseOutboundSignatureHeader,
  signHmacSha256Hex,
  verifyHmacSha256Hex,
} from '../webhook-signature'

describe('buildInboundBase', () => {
  it('builds the POST base exactly as specified', () => {
    const digest = createHash('sha256').update('{}').digest('hex')
    const base = buildInboundBase('member.create', 'int-1', '1700000000', 'nonce-abc', digest)
    expect(base).toBe(`v2:member.create:int-1:1700000000:nonce-abc:${digest}`)
  })

  it('builds the GET base exactly as specified', () => {
    const base = buildInboundBase('member.job', 'int-1', '1700000000', 'nonce-abc', 'mj_xyz')
    expect(base).toBe('v2:member.job:int-1:1700000000:nonce-abc:mj_xyz')
  })
})

describe('sign / verify round trip', () => {
  it('verifies a signature produced by signHmacSha256Hex', () => {
    const secret = 'shh'
    const base = 'v2:member.create:int-1:1700000000:nonce-abc:deadbeef'
    const sig = signHmacSha256Hex(secret, base)
    expect(verifyHmacSha256Hex(secret, base, sig)).toBe(true)
  })

  it('rejects a signature made with the wrong secret', () => {
    const base = 'v2:member.create:int-1:1700000000:nonce-abc:deadbeef'
    const sig = signHmacSha256Hex('secret-a', base)
    expect(verifyHmacSha256Hex('secret-b', base, sig)).toBe(false)
  })

  it('rejects a tampered base', () => {
    const secret = 'shh'
    const sig = signHmacSha256Hex(secret, 'v2:member.create:int-1:1700000000:nonce-abc:deadbeef')
    expect(verifyHmacSha256Hex(secret, 'v2:member.create:int-1:1700000000:nonce-abc:cafebabe', sig)).toBe(false)
  })

  it('rejects a non-hex or wrong-length candidate without throwing', () => {
    const secret = 'shh'
    const base = 'v2:member.create:int-1:1700000000:nonce-abc:deadbeef'
    expect(verifyHmacSha256Hex(secret, base, 'not-hex!!')).toBe(false)
    expect(verifyHmacSha256Hex(secret, base, 'ab')).toBe(false)
  })
})

describe('parseOutboundSignatureHeader', () => {
  const validV1 = 'a'.repeat(64)

  it('parses t= and v1= in either order', () => {
    expect(parseOutboundSignatureHeader(`t=1700000000,v1=${validV1}`)).toEqual({
      t: '1700000000',
      v1: validV1,
    })
    expect(parseOutboundSignatureHeader(`v1=${validV1},t=1700000000`)).toEqual({
      t: '1700000000',
      v1: validV1,
    })
  })

  it.each([
    ['missing v1', 't=1700000000'],
    ['duplicate t', `t=1,t=2,v1=${validV1}`],
    ['unknown param', `t=1700000000,v1=${validV1},v2=extra`],
    ['non-numeric t', `t=abc,v1=${validV1}`],
    ['short v1', 't=1700000000,v1=ab'],
    ['empty string', ''],
    ['no equals sign', 'garbage'],
  ])('rejects %s: %s', (_label, header) => {
    expect(parseOutboundSignatureHeader(header)).toEqual({ error: 'malformed' })
  })
})

describe('parseInboundSignatureHeader', () => {
  const validV2 = 'b'.repeat(64)

  it('parses a well-formed v2= header', () => {
    expect(parseInboundSignatureHeader(`v2=${validV2}`)).toEqual({ v2: validV2 })
  })

  it.each([
    ['two params (only one allowed)', `v2=${validV2},extra=1`],
    ['wrong key', `v1=${validV2}`],
    ['short value', 'v2=ab'],
    ['empty string', ''],
  ])('rejects %s: %s', (_label, header) => {
    expect(parseInboundSignatureHeader(header)).toEqual({ error: 'malformed' })
  })
})
