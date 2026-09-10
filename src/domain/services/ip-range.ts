// INT-001 T-C3: pure CIDR-containment checks over the SSRF blocklist named in
// the threat model (§3-E). No dependency -- "~40 lines of explicit CIDR
// checks" per the threat model's own recommendation (`ip-address` already
// carries a HIGH advisory in this lockfile and isn't worth the surface for a
// fixed block list).
//
// This module is pure (no DNS, no network) -- the resolve-and-pin step that
// actually calls `dns.promises.lookup` and decides which addresses to dial
// belongs to WI-5's `ssrf-guard.ts`, which is expected to import
// `isBlockedIpv4` / `isBlockedIpv6` / `isBlockedIp` from here rather than
// re-implement the blocklist.

const IPV4_BLOCKLIST: ReadonlyArray<[string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
]

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  let value = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const n = Number(part)
    if (n < 0 || n > 255) return null
    value = (value << 8) | n
  }
  return value >>> 0
}

export function isBlockedIpv4(ip: string): boolean {
  const value = ipv4ToInt(ip)
  if (value === null) return false
  for (const [base, prefixLen] of IPV4_BLOCKLIST) {
    const baseValue = ipv4ToInt(base)
    if (baseValue === null) continue
    const mask = prefixLen === 0 ? 0 : (0xffffffff << (32 - prefixLen)) >>> 0
    if ((value & mask) === (baseValue & mask)) return true
  }
  return false
}

// Expands a full (non-compressed) or compressed IPv6 address into 8
// hextet numbers, or null if malformed. Handles `::` expansion only --
// callers are expected to feed already-canonical addresses from
// `dns.promises.lookup`, not arbitrary user text.
function ipv4DottedToHextets(dotted: string): [number, number] | null {
  const octets = dotted.split('.')
  if (octets.length !== 4) return null
  const nums: number[] = []
  for (const o of octets) {
    if (!/^\d{1,3}$/.test(o)) return null
    const n = Number(o)
    if (n < 0 || n > 255) return null
    nums.push(n)
  }
  return [(nums[0] << 8) | nums[1], (nums[2] << 8) | nums[3]]
}

function ipv6ToHextets(rawIp: string): number[] | null {
  let ip = rawIp.includes('%') ? rawIp.split('%')[0] : rawIp // strip zone id

  // IPv4-mapped / IPv4-compatible notation embeds a dotted-quad as the last
  // group (e.g. `::ffff:127.0.0.1`). Convert it to two hex groups so the
  // rest of this function only ever deals in plain hextets.
  if (ip.includes('.')) {
    const lastColon = ip.lastIndexOf(':')
    if (lastColon === -1) return null
    const v4 = ipv4DottedToHextets(ip.slice(lastColon + 1))
    if (!v4) return null
    ip = `${ip.slice(0, lastColon + 1)}${v4[0].toString(16)}:${v4[1].toString(16)}`
  }

  const doubleColonParts = ip.split('::')
  if (doubleColonParts.length > 2) return null

  const parseGroup = (s: string): number[] | null => {
    if (s === '') return []
    const groups = s.split(':')
    const out: number[] = []
    for (const g of groups) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null
      out.push(parseInt(g, 16))
    }
    return out
  }

  if (doubleColonParts.length === 1) {
    const groups = parseGroup(doubleColonParts[0])
    return groups && groups.length === 8 ? groups : null
  }

  const head = parseGroup(doubleColonParts[0])
  const tail = parseGroup(doubleColonParts[1])
  if (!head || !tail) return null
  const missing = 8 - head.length - tail.length
  if (missing < 0) return null
  return [...head, ...new Array(missing).fill(0), ...tail]
}

// BigInt literal syntax (`0n`) requires an ES2020+ target; this project
// targets ES2017, so every BigInt is constructed via `BigInt(...)` instead
// -- functionally identical, just without the literal suffix.
const BIG_ZERO = BigInt(0)
const BIG_ONE = BigInt(1)
const BIG_SIXTEEN = BigInt(16)

function ipv6ToBigInt(ip: string): bigint | null {
  const hextets = ipv6ToHextets(ip)
  if (!hextets) return null
  let value = BIG_ZERO
  for (const h of hextets) value = (value << BIG_SIXTEEN) | BigInt(h)
  return value
}

const IPV6_BLOCKLIST: ReadonlyArray<[string, number]> = [
  ['::1', 128],
  ['::', 128],
  ['::ffff:0:0', 96],
  ['fc00::', 7],
  ['fe80::', 10],
  ['2001:db8::', 32],
]

/** Extracts the embedded IPv4 from an IPv4-mapped IPv6 address
 * (`::ffff:a.b.c.d` or its all-hex form `::ffff:AABB:CCDD`), or null. */
export function extractIpv4MappedAddress(ip: string): string | null {
  const value = ipv6ToBigInt(ip)
  if (value === null) return null
  const mapped = BigInt(0xffff00000000)
  const mask = BigInt(0xffffffffffff) << BigInt(32) // top 96 bits must be ::ffff:0:0
  if ((value & mask) !== mapped) return null
  const v4 = value & BigInt(0xffffffff)
  const byteMask = BigInt(0xff)
  return [
    (v4 >> BigInt(24)) & byteMask,
    (v4 >> BigInt(16)) & byteMask,
    (v4 >> BigInt(8)) & byteMask,
    v4 & byteMask,
  ].join('.')
}

export function isBlockedIpv6(ip: string): boolean {
  const value = ipv6ToBigInt(ip)
  if (value === null) return false

  // IPv4-mapped: check the EMBEDDED v4 against the v4 blocklist too (a
  // rebinding attempt can hide 127.0.0.1 as ::ffff:127.0.0.1).
  const mappedV4 = extractIpv4MappedAddress(ip)
  if (mappedV4 && isBlockedIpv4(mappedV4)) return true

  const fullMask = (BIG_ONE << BigInt(128)) - BIG_ONE
  for (const [base, prefixLen] of IPV6_BLOCKLIST) {
    const baseValue = ipv6ToBigInt(base)
    if (baseValue === null) continue
    const mask =
      prefixLen === 0 ? BIG_ZERO : (fullMask << BigInt(128 - prefixLen)) & fullMask
    if ((value & mask) === (baseValue & mask)) return true
  }
  return false
}

/** Dispatches to the v4 or v6 blocklist by address shape. Unparseable input
 * is treated as NOT blocked -- callers must reject unparseable addresses
 * upstream (an unparseable string is not a usable dial target either way). */
export function isBlockedIp(ip: string): boolean {
  if (ip.includes(':')) return isBlockedIpv6(ip)
  return isBlockedIpv4(ip)
}
