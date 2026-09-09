// INT-001 T-C3: the SSRF guard for the outbound webhook path. Two halves:
//
// - `assertSafeUrl` -- pure, synchronous format checks (scheme, port,
//   userinfo, blocked host names). No I/O.
// - `resolveAndPin` -- resolves the hostname (or accepts it directly if
//   it's already a literal IP), rejects unless EVERY returned address is
//   public, and returns exactly one address to pin the connection to. This
//   is the anti-rebinding control: whatever calls this function is expected
//   to dial the returned `ip` directly rather than letting the transport
//   re-resolve the hostname on its own (see `outbound-webhook-sender.ts`'s
//   `lookup` override, which does exactly that).
//
// Both are called by `src/application/validate-outbound-url.ts` (save-time,
// WI-8) and internally by `UndiciOutboundSender.send()` (attempt-time,
// WI-5/WI-6) -- ONE set of rules enforced at both points (T-C4's
// mitigation).
//
// Deliberately co-located in `src/infrastructure/http/` per the plan's own
// file list, even though `assertSafeUrl` itself does no I/O -- this file is
// the single SSRF-guard unit, not split across layers.

import { promises as dns } from 'node:dns'
import net from 'node:net'
import { isBlockedIp } from '@/domain/services/ip-range'

export interface SafeUrlError {
  title: 'invalid_url' | 'ssrf_rejected'
  details: string
}

export type AssertSafeUrlResult =
  | { ok: true; url: URL; hostname: string }
  | { ok: false; error: SafeUrlError }

export interface AssertSafeUrlDeps {
  /** Ports allowed besides the default (empty `url.port`, i.e. 443).
   * ONLY ever set by `createLoopbackTestGuard()` in test code, scoped to
   * the exact ephemeral port of a throwaway test server -- production
   * never passes this. */
  allowedPorts?: Set<number>
}

const NAME_BLOCKLIST_EXACT = new Set(['localhost', 'metadata.google.internal'])
const NAME_BLOCKLIST_SUFFIXES = ['.internal', '.local', '.localhost']

export function assertSafeUrl(rawUrl: string, deps: AssertSafeUrlDeps = {}): AssertSafeUrlResult {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return { ok: false, error: { title: 'invalid_url', details: 'not_a_valid_url' } }
  }

  if (url.protocol !== 'https:') {
    return { ok: false, error: { title: 'invalid_url', details: 'https_required' } }
  }
  if (url.username !== '' || url.password !== '') {
    return { ok: false, error: { title: 'invalid_url', details: 'userinfo_not_allowed' } }
  }
  if (url.port !== '' && url.port !== '443' && !(deps.allowedPorts?.has(Number(url.port)))) {
    return { ok: false, error: { title: 'invalid_url', details: 'port_443_only' } }
  }

  const hostname = url.hostname.toLowerCase()
  if (NAME_BLOCKLIST_EXACT.has(hostname)) {
    return { ok: false, error: { title: 'ssrf_rejected', details: `blocked_host_name:${hostname}` } }
  }
  if (NAME_BLOCKLIST_SUFFIXES.some((suffix) => hostname === suffix.slice(1) || hostname.endsWith(suffix))) {
    return { ok: false, error: { title: 'ssrf_rejected', details: `blocked_host_suffix:${hostname}` } }
  }

  return { ok: true, url, hostname }
}

export interface ResolvedAddress {
  address: string
  family: number
}

export interface ResolveAndPinDeps {
  /** Overridable DNS resolver. Defaults to `dns.promises.lookup(hostname,
   * {all: true, verbatim: true})`. Tests inject this to simulate DNS
   * rebinding (a different answer on a later, independent call) without a
   * real DNS server. */
  resolve?: (hostname: string) => Promise<ResolvedAddress[]>
  /** Overridable per-address allow check. Defaults to `!isBlockedIp(ip)`
   * (the production blocklist). ONLY ever narrowed-then-widened-for-one-IP
   * by `createLoopbackTestGuard()` in test code. */
  isAddressAllowed?: (ip: string) => boolean
}

export type ResolveAndPinResult =
  | { ok: true; ip: string; family: 4 | 6 }
  | { ok: false; error: { title: 'ssrf_rejected' | 'dns_error'; details: string } }

function stripIpv6Brackets(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
}

async function defaultResolve(hostname: string): Promise<ResolvedAddress[]> {
  return dns.lookup(hostname, { all: true, verbatim: true })
}

export async function resolveAndPin(
  hostname: string,
  deps: ResolveAndPinDeps = {}
): Promise<ResolveAndPinResult> {
  const resolve = deps.resolve ?? defaultResolve
  const isAllowed = deps.isAddressAllowed ?? ((ip: string) => !isBlockedIp(ip))

  const bare = stripIpv6Brackets(hostname)
  const literalFamily = net.isIP(bare)

  let addresses: ResolvedAddress[]
  if (literalFamily !== 0) {
    // The URL's host is already a literal IP -- no DNS involved, and no
    // rebinding surface either. Check it directly against the blocklist.
    addresses = [{ address: bare, family: literalFamily }]
  } else {
    try {
      addresses = await resolve(bare)
    } catch {
      return { ok: false, error: { title: 'dns_error', details: 'resolution_failed' } }
    }
  }

  if (!addresses || addresses.length === 0) {
    return { ok: false, error: { title: 'dns_error', details: 'no_addresses' } }
  }

  // Every returned address must be public -- one private/link-local answer
  // among several public ones is still a rejection (a partner destination
  // that resolves to both a real IP and, say, an internal load balancer
  // address is not safe just because one answer looks fine).
  for (const addr of addresses) {
    if (!isAllowed(addr.address)) {
      return { ok: false, error: { title: 'ssrf_rejected', details: `blocked_address:${addr.address}` } }
    }
  }

  const pinned = addresses[0]
  return { ok: true, ip: pinned.address, family: pinned.family === 6 ? 6 : 4 }
}
