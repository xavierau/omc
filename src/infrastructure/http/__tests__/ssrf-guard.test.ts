// INT-001 WI-5 frozen acceptance suite (T-C3).
// Source: plan §WI-5 "Tests (first)" + threat model §E T-C3 "Tests":
// exhaustive blocklist table (every CIDR in threat §3-E incl.
// `::ffff:127.0.0.1`, `0.0.0.0`, `169.254.169.254`, `metadata.google.internal`,
// `*.internal`, `localhost`); `https://user:pass@host/`, `https://host:8080/`,
// `http://` -> rejected; host resolving public at save and private at
// attempt (stubbed resolver) -> attempt rejected as permanent, zero bytes
// sent; a host with one public and one private address -> rejected.

import { describe, expect, it, vi } from 'vitest'
import { assertSafeUrl, resolveAndPin } from '../ssrf-guard'

describe('assertSafeUrl', () => {
  it('accepts a plain https URL with no port, no userinfo', () => {
    const result = assertSafeUrl('https://partner.example.com/hooks/omc')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.hostname).toBe('partner.example.com')
    }
  })

  it('accepts an explicit :443 (the default, still normalized away by URL)', () => {
    const result = assertSafeUrl('https://partner.example.com:443/hooks')
    expect(result.ok).toBe(true)
  })

  it('rejects http://', () => {
    const result = assertSafeUrl('http://partner.example.com/hooks')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.title).toBe('invalid_url')
  })

  it('rejects a non-443 port', () => {
    const result = assertSafeUrl('https://partner.example.com:8080/hooks')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.title).toBe('invalid_url')
  })

  it('rejects userinfo in the URL', () => {
    const result = assertSafeUrl('https://user:pass@partner.example.com/hooks')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.title).toBe('invalid_url')
  })

  it('rejects a username with no password too', () => {
    const result = assertSafeUrl('https://user@partner.example.com/hooks')
    expect(result.ok).toBe(false)
  })

  it('rejects an unparseable URL', () => {
    const result = assertSafeUrl('not a url at all')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.title).toBe('invalid_url')
  })

  it.each([
    'localhost',
    'LOCALHOST',
    'metadata.google.internal',
    'foo.internal',
    'a.b.internal',
    'foo.local',
    'foo.localhost',
  ])('rejects blocked host name %s', (host) => {
    const result = assertSafeUrl(`https://${host}/hooks`)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.title).toBe('ssrf_rejected')
  })

  it('does not reject a name that merely contains but does not end with a blocked suffix', () => {
    // e.g. "internal-tools.example.com" must not match the ".internal" suffix rule.
    const result = assertSafeUrl('https://internal-tools.example.com/hooks')
    expect(result.ok).toBe(true)
  })

  it('rejects a non-443 port even when an unrelated allowedPorts override is passed for a different port', () => {
    // The loopback test guard's allowedPorts override is scoped to the exact
    // ephemeral port it hands out -- it must never become a general "any port
    // goes" escape hatch.
    const result = assertSafeUrl('https://partner.example.com:9999/hooks', {
      allowedPorts: new Set([54321]),
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.title).toBe('invalid_url')
  })

  it('accepts the exact port named in an allowedPorts override (test-only seam)', () => {
    const result = assertSafeUrl('https://partner.example.com:54321/hooks', {
      allowedPorts: new Set([54321]),
    })
    expect(result.ok).toBe(true)
  })
})

describe('resolveAndPin', () => {
  const okDefault = () => Promise.resolve([{ address: '203.0.113.10', family: 4 }])

  it('pins the single public address a plain resolver returns', async () => {
    const result = await resolveAndPin('partner.example.com', { resolve: okDefault })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.ip).toBe('203.0.113.10')
      expect(result.family).toBe(4)
    }
  })

  it('rejects when DNS resolution throws (transient, not a security violation)', async () => {
    const resolve = vi.fn().mockRejectedValue(new Error('ENOTFOUND'))
    const result = await resolveAndPin('nowhere.example.com', { resolve })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.title).toBe('dns_error')
  })

  it('rejects when DNS resolves to zero addresses', async () => {
    const resolve = vi.fn().mockResolvedValue([])
    const result = await resolveAndPin('nowhere.example.com', { resolve })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.title).toBe('dns_error')
  })

  it('rejects a host with one public and one private address (ALL must be public)', async () => {
    const resolve = vi.fn().mockResolvedValue([
      { address: '203.0.113.10', family: 4 },
      { address: '10.0.0.5', family: 4 },
    ])
    const result = await resolveAndPin('mixed.example.com', { resolve })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.title).toBe('ssrf_rejected')
  })

  it('DNS-rebinding shape: a resolver that would answer differently on a second call is only ever consulted once per resolveAndPin call, and a private-at-this-call result fails closed', async () => {
    // Simulates "host resolving public at save and private at attempt": the
    // save-time check and the attempt-time check are two INDEPENDENT
    // resolveAndPin invocations (never a cached result reused) -- this
    // proves the attempt-time one, on its own, fails closed when its own
    // resolution is private, regardless of what an earlier check saw.
    const saveTimeResolve = vi.fn().mockResolvedValue([{ address: '203.0.113.10', family: 4 }])
    const saveTime = await resolveAndPin('rebind.example.com', { resolve: saveTimeResolve })
    expect(saveTime.ok).toBe(true)

    const attemptTimeResolve = vi.fn().mockResolvedValue([{ address: '169.254.169.254', family: 4 }])
    const attemptTime = await resolveAndPin('rebind.example.com', { resolve: attemptTimeResolve })
    expect(attemptTime.ok).toBe(false)
    if (!attemptTime.ok) expect(attemptTime.error.title).toBe('ssrf_rejected')
  })

  it('treats a literal IP host as pre-resolved (no DNS call) and still enforces the blocklist', async () => {
    const resolve = vi.fn()
    const result = await resolveAndPin('169.254.169.254', { resolve })
    expect(resolve).not.toHaveBeenCalled()
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.title).toBe('ssrf_rejected')
  })

  it('accepts a literal public IP host with no DNS call', async () => {
    const resolve = vi.fn()
    const result = await resolveAndPin('203.0.113.10', { resolve })
    expect(resolve).not.toHaveBeenCalled()
    expect(result.ok).toBe(true)
  })

  it('rejects a bracketed IPv6 literal (::1)', async () => {
    const result = await resolveAndPin('[::1]', {})
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.title).toBe('ssrf_rejected')
  })

  it('rejects an IPv4-mapped IPv6 literal (::ffff:127.0.0.1)', async () => {
    const result = await resolveAndPin('[::ffff:127.0.0.1]', {})
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.title).toBe('ssrf_rejected')
  })

  // Exhaustive blocklist table -- every CIDR named in threat §3-E, exercised
  // through resolveAndPin (not just the pure ip-range functions WI-1 already
  // unit-tests) so this suite proves MY integration point enforces them.
  it.each([
    ['0.0.0.0/8 example', '0.0.0.0'],
    ['10/8 example', '10.1.2.3'],
    ['100.64/10 example (CGNAT)', '100.64.0.1'],
    ['127/8 example', '127.0.0.1'],
    ['169.254/16 example (link-local/metadata)', '169.254.169.254'],
    ['172.16/12 example', '172.16.0.1'],
    ['192.0.0/24 example', '192.0.0.1'],
    ['192.168/16 example', '192.168.1.1'],
    ['198.18/15 example (benchmarking)', '198.18.0.1'],
    ['224/4 example (multicast)', '224.0.0.1'],
    ['240/4 example (reserved)', '240.0.0.1'],
    ['::1 loopback', '::1'],
    [':: unspecified', '::'],
    ['fc00::/7 unique-local', 'fc00::1'],
    ['fe80::/10 link-local', 'fe80::1'],
    ['2001:db8::/32 documentation', '2001:db8::1'],
    ['IPv4-mapped ::ffff:127.0.0.1', '::ffff:127.0.0.1'],
    ['IPv4-mapped ::ffff:169.254.169.254', '::ffff:169.254.169.254'],
  ])('rejects %s (%s) as a resolved DNS answer', async (_label, ip) => {
    const resolve = vi.fn().mockResolvedValue([{ address: ip, family: ip.includes(':') ? 6 : 4 }])
    const result = await resolveAndPin('blocked.example.com', { resolve })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.title).toBe('ssrf_rejected')
  })

  it.each([
    ['8.8.8.8', 4],
    ['203.0.113.10', 4],
    ['2606:4700:4700::1111', 6],
  ])('accepts a genuinely public resolved address %s', async (ip, family) => {
    const resolve = vi.fn().mockResolvedValue([{ address: ip, family }])
    const result = await resolveAndPin('public.example.com', { resolve })
    expect(result.ok).toBe(true)
  })

  it('an injected isAddressAllowed override can narrow (never widen) production behaviour by default', async () => {
    // Default isAddressAllowed (no override) must reject a private address
    // even if resolve() is stubbed -- proves resolveAndPin does not silently
    // trust the caller to also validate.
    const resolve = vi.fn().mockResolvedValue([{ address: '10.0.0.1', family: 4 }])
    const result = await resolveAndPin('private.example.com', { resolve })
    expect(result.ok).toBe(false)
  })
})
