// INT-001 WI-2 T-H3a/T-H3b: pure job-id construction. This is deliberately
// KEY CONSTRUCTION ONLY -- the Redis idempotency record (`int001:idem:{jobId}`,
// 24h TTL) that makes a resubmission actually return the same 202 is
// written by WI-3, which is the first WI to have a validated request body
// and a real job row to key it against.
//
// jobId = "mj_" + base32(HMAC-SHA256(INT_JOBID_KEY, integrationId + ":" + e164 + ":" + bodyHash)).slice(0, 32)
// bodyHash = sha256hex(canonicalBody), canonicalBody = JSON.stringify(sortKeysDeep({...}))

import { createHash, createHmac } from 'node:crypto'

export interface MemberJobCanonicalInput {
  phone: string
  consent_level: string
  name?: string | null
  external_ref?: string | null
  language?: string | null
  send_welcome?: boolean | null
  metadata?: Record<string, unknown> | null
}

/** Recursively sorts object keys so JSON.stringify output is stable
 * regardless of the input's original key order. Arrays keep their order
 * (order is semantically meaningful there); only object keys are sorted. */
export function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep)
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortKeysDeep((value as Record<string, unknown>)[key])
    }
    return sorted
  }
  return value
}

/** `undefined` and `null` on an optional field canonicalise identically
 * ("field absent"), so a partner omitting a field vs. sending it as null
 * never produces two different job ids for what is semantically the same
 * request. */
export function canonicalizeMemberJobBody(input: MemberJobCanonicalInput): string {
  const normalised = {
    phone: input.phone,
    consent_level: input.consent_level,
    name: input.name ?? null,
    external_ref: input.external_ref ?? null,
    language: input.language ?? null,
    send_welcome: input.send_welcome ?? null,
    metadata: input.metadata ?? null,
  }
  return JSON.stringify(sortKeysDeep(normalised))
}

const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567'

/** RFC4648-shaped base32 (lowercase, unpadded) -- only used to render an
 * HMAC digest as a compact, URL-safe, case-insensitive-in-practice string
 * for a job id that travels in URLs, response bodies and logs. */
function base32Encode(buffer: Buffer): string {
  let bits = 0
  let value = 0
  let output = ''
  for (const byte of buffer) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 0x1f]
      bits -= 5
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f]
  }
  return output
}

const JOB_ID_PREFIX = 'mj_'
const JOB_ID_SUFFIX_LENGTH = 32

/**
 * Deterministic, HMAC-keyed, content-addressed job id. Same
 * (jobIdKey, integrationId, e164, canonical body) always produces the same
 * id; changing any one of them (including an upgraded consent_level)
 * produces a different one.
 */
export function buildMemberJobId(
  jobIdKey: string,
  integrationId: string,
  e164: string,
  input: MemberJobCanonicalInput
): string {
  const canonicalBody = canonicalizeMemberJobBody(input)
  const bodyHash = createHash('sha256').update(canonicalBody).digest('hex')
  const mac = createHmac('sha256', jobIdKey)
    .update(`${integrationId}:${e164}:${bodyHash}`)
    .digest()
  const encoded = base32Encode(mac).slice(0, JOB_ID_SUFFIX_LENGTH)
  return `${JOB_ID_PREFIX}${encoded}`
}

/**
 * Same as `buildMemberJobId`, reading the HMAC key from `INT_JOBID_KEY`.
 * Fails loud (never derives a key from a default) -- an unset key must
 * never silently produce a guessable job id. Intended for WI-3's real call
 * sites; tests should call `buildMemberJobId` directly with an explicit key.
 */
export function buildMemberJobIdFromEnv(
  integrationId: string,
  e164: string,
  input: MemberJobCanonicalInput
): string {
  const key = process.env.INT_JOBID_KEY
  if (!key) {
    throw new Error('build-member-job-id: INT_JOBID_KEY is not set')
  }
  return buildMemberJobId(key, integrationId, e164, input)
}
