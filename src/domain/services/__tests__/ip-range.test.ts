// Smoke coverage for the CIDR blocklist WI-1 owns. The EXHAUSTIVE blocklist
// table (every CIDR in threat §3-E, redirect/rebinding scenarios) is WI-5's
// acceptance suite (src/infrastructure/http/__tests__/ssrf-guard.test.ts) --
// this file only proves the pure containment math is correct.

import { describe, expect, it } from 'vitest'
import {
  extractIpv4MappedAddress,
  isBlockedIp,
  isBlockedIpv4,
  isBlockedIpv6,
} from '../ip-range'

describe('isBlockedIpv4', () => {
  it.each([
    ['GCE metadata', '169.254.169.254'],
    ['unspecified', '0.0.0.0'],
    ['loopback', '127.0.0.1'],
    ['RFC1918 10/8', '10.1.2.3'],
    ['RFC1918 172.16/12', '172.20.0.1'],
    ['RFC1918 192.168/16', '192.168.1.1'],
    ['CGNAT 100.64/10', '100.64.0.1'],
    ['multicast', '224.0.0.1'],
    ['reserved 240/4', '250.1.1.1'],
    ['benchmarking 198.18/15', '198.19.0.1'],
  ])('blocks %s (%s)', (_label, ip) => {
    expect(isBlockedIpv4(ip)).toBe(true)
  })

  it.each([
    ['public DNS', '8.8.8.8'],
    ['public web', '93.184.216.34'],
  ])('does not block %s (%s)', (_label, ip) => {
    expect(isBlockedIpv4(ip)).toBe(false)
  })

  it('returns false for unparseable input rather than throwing', () => {
    expect(isBlockedIpv4('not-an-ip')).toBe(false)
    expect(isBlockedIpv4('999.999.999.999')).toBe(false)
  })
})

describe('isBlockedIpv6', () => {
  it.each([
    ['loopback', '::1'],
    ['unspecified', '::'],
    ['unique-local fc00::/7', 'fc00::1'],
    ['unique-local fd00::/8 (within fc00::/7)', 'fd12:3456::1'],
    ['link-local fe80::/10', 'fe80::1'],
    ['documentation 2001:db8::/32', '2001:db8::1'],
  ])('blocks %s (%s)', (_label, ip) => {
    expect(isBlockedIpv6(ip)).toBe(true)
  })

  it('blocks an IPv4-mapped loopback via the embedded v4 (rebinding defence)', () => {
    expect(isBlockedIpv6('::ffff:127.0.0.1')).toBe(true)
  })

  it('blocks an IPv4-mapped metadata address', () => {
    expect(isBlockedIpv6('::ffff:169.254.169.254')).toBe(true)
  })

  it('does not block a public IPv6 address', () => {
    expect(isBlockedIpv6('2001:4860:4860::8888')).toBe(false)
  })

  it('returns false for unparseable input rather than throwing', () => {
    expect(isBlockedIpv6('not-an-ip')).toBe(false)
  })
})

describe('extractIpv4MappedAddress', () => {
  it('extracts the embedded v4 from ::ffff:a.b.c.d', () => {
    expect(extractIpv4MappedAddress('::ffff:127.0.0.1')).toBe('127.0.0.1')
  })

  it('returns null for a non-mapped address', () => {
    expect(extractIpv4MappedAddress('2001:db8::1')).toBeNull()
  })
})

describe('isBlockedIp', () => {
  it('dispatches to v4 for a dotted-quad string', () => {
    expect(isBlockedIp('169.254.169.254')).toBe(true)
    expect(isBlockedIp('8.8.8.8')).toBe(false)
  })

  it('dispatches to v6 for a colon-containing string', () => {
    expect(isBlockedIp('::1')).toBe(true)
    expect(isBlockedIp('2001:4860:4860::8888')).toBe(false)
  })
})
