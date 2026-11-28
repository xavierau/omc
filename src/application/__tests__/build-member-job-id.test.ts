// INT-001 WI-2 T-H3a/T-H3b (key construction only -- the Redis idempotency
// record itself is written by WI-3). Frozen acceptance-suite items covered
// here (plan §WI-2 "Tests (first)"):
//   - same body -> same jobId
//   - different INT_JOBID_KEY -> different id
//   - canonicalisation ignores key order/whitespace

import { describe, expect, it } from 'vitest'
import {
  buildMemberJobId,
  canonicalizeMemberJobBody,
  type MemberJobCanonicalInput,
} from '../build-member-job-id'

const BASE_INPUT: MemberJobCanonicalInput = {
  phone: '+85298765432',
  consent_level: 'utility',
  name: 'Ada Lovelace',
  external_ref: 'ext-1',
  language: 'en',
  send_welcome: true,
  metadata: { a: 1, b: { c: 2 } },
}

describe('canonicalizeMemberJobBody', () => {
  it('is stable regardless of input key order (top-level and nested)', () => {
    const reordered: MemberJobCanonicalInput = {
      metadata: { b: { c: 2 }, a: 1 },
      send_welcome: true,
      language: 'en',
      external_ref: 'ext-1',
      name: 'Ada Lovelace',
      consent_level: 'utility',
      phone: '+85298765432',
    }
    expect(canonicalizeMemberJobBody(BASE_INPUT)).toBe(canonicalizeMemberJobBody(reordered))
  })

  it('does not conflate a missing optional field with an empty string', () => {
    const withUndefinedName = canonicalizeMemberJobBody({ ...BASE_INPUT, name: undefined })
    const withNullName = canonicalizeMemberJobBody({ ...BASE_INPUT, name: null })
    expect(withUndefinedName).toBe(withNullName)
    expect(withUndefinedName).not.toBe(canonicalizeMemberJobBody({ ...BASE_INPUT, name: '' }))
  })

  it('is sensitive to a genuine content change', () => {
    const changed = canonicalizeMemberJobBody({ ...BASE_INPUT, consent_level: 'all' })
    expect(canonicalizeMemberJobBody(BASE_INPUT)).not.toBe(changed)
  })
})

describe('buildMemberJobId', () => {
  const KEY_A = 'test-int-jobid-key-a'
  const KEY_B = 'test-int-jobid-key-b'

  it('produces the same jobId for the same key, integration, phone and canonical body', () => {
    const first = buildMemberJobId(KEY_A, 'int-1', '+85298765432', BASE_INPUT)
    const second = buildMemberJobId(KEY_A, 'int-1', '+85298765432', { ...BASE_INPUT })
    expect(first).toBe(second)
  })

  it('is insensitive to key order in the input (canonicalisation applied before hashing)', () => {
    const reordered: MemberJobCanonicalInput = {
      metadata: { b: { c: 2 }, a: 1 },
      send_welcome: true,
      language: 'en',
      external_ref: 'ext-1',
      name: 'Ada Lovelace',
      consent_level: 'utility',
      phone: '+85298765432',
    }
    const first = buildMemberJobId(KEY_A, 'int-1', '+85298765432', BASE_INPUT)
    const second = buildMemberJobId(KEY_A, 'int-1', '+85298765432', reordered)
    expect(first).toBe(second)
  })

  it('produces a different id when INT_JOBID_KEY differs', () => {
    const withKeyA = buildMemberJobId(KEY_A, 'int-1', '+85298765432', BASE_INPUT)
    const withKeyB = buildMemberJobId(KEY_B, 'int-1', '+85298765432', BASE_INPUT)
    expect(withKeyA).not.toBe(withKeyB)
  })

  it('produces a different id for a different integration', () => {
    const first = buildMemberJobId(KEY_A, 'int-1', '+85298765432', BASE_INPUT)
    const second = buildMemberJobId(KEY_A, 'int-2', '+85298765432', BASE_INPUT)
    expect(first).not.toBe(second)
  })

  it('produces a different id for a different phone', () => {
    const first = buildMemberJobId(KEY_A, 'int-1', '+85298765432', BASE_INPUT)
    const second = buildMemberJobId(KEY_A, 'int-1', '+85211112222', BASE_INPUT)
    expect(first).not.toBe(second)
  })

  it('produces a different id when the body content changes (e.g. a consent-level upgrade)', () => {
    const first = buildMemberJobId(KEY_A, 'int-1', '+85298765432', BASE_INPUT)
    const upgraded = buildMemberJobId(KEY_A, 'int-1', '+85298765432', { ...BASE_INPUT, consent_level: 'all' })
    expect(first).not.toBe(upgraded)
  })

  it('is prefixed "mj_" and 32 chars of a URL-safe alphabet after the prefix', () => {
    const id = buildMemberJobId(KEY_A, 'int-1', '+85298765432', BASE_INPUT)
    expect(id.startsWith('mj_')).toBe(true)
    expect(id.slice(3)).toMatch(/^[a-z0-9]{32}$/)
  })
})
