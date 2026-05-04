import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ConsentRecord, type GrantConsentInput } from '../consent-record'

const FIXED_NOW = new Date('2026-05-04T12:00:00.000Z')

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(FIXED_NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

function buildGrant(overrides: Partial<GrantConsentInput> = {}): GrantConsentInput {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    restaurantId: 'rest-1',
    memberId: 'mem-1',
    phoneE164: '85291234567',
    category: 'marketing',
    source: 'website_form',
    sourceReference: 'https://example.test/join',
    businessNameShown: 'Demo Cafe',
    grade: 'strong',
    capturedIp: '203.0.113.10',
    capturedUserAgent: 'Mozilla/5.0',
    ...overrides,
  }
}

describe('ConsentRecord.grant', () => {
  it('constructs an opted_in record stamped with captured_at = now()', () => {
    const r = ConsentRecord.grant(buildGrant())
    expect(r.snapshot).toMatchObject({
      id: '11111111-1111-1111-1111-111111111111',
      restaurantId: 'rest-1',
      memberId: 'mem-1',
      phoneE164: '85291234567',
      category: 'marketing',
      status: 'opted_in',
      consentGrade: 'strong',
      source: 'website_form',
      sourceReference: 'https://example.test/join',
      businessNameShown: 'Demo Cafe',
      capturedIp: '203.0.113.10',
      capturedUserAgent: 'Mozilla/5.0',
      revokedAt: null,
    })
    expect(r.snapshot.capturedAt).toBe(FIXED_NOW.toISOString())
  })

  it('defaults grade to strong when not provided', () => {
    const r = ConsentRecord.grant(buildGrant({ grade: undefined }))
    expect(r.snapshot.consentGrade).toBe('strong')
  })

  it('honours an explicit capturedAt for backfilled / imported records', () => {
    const past = '2025-08-01T00:00:00.000Z'
    const r = ConsentRecord.grant(buildGrant({ capturedAt: new Date(past) }))
    expect(r.snapshot.capturedAt).toBe(past)
  })

  it('rejects an empty source — audit defence requires it', () => {
    expect(() => ConsentRecord.grant(buildGrant({ source: '' }))).toThrow(
      /source/i
    )
    expect(() =>
      ConsentRecord.grant(buildGrant({ source: '   ' }))
    ).toThrow(/source/i)
  })

  it('rejects an empty phoneE164', () => {
    expect(() =>
      ConsentRecord.grant(buildGrant({ phoneE164: '' }))
    ).toThrow(/phone/i)
  })
})

describe('ConsentRecord.markPending', () => {
  it('constructs a pending record (for double-opt-in flows)', () => {
    const r = ConsentRecord.markPending({
      id: '22222222-2222-2222-2222-222222222222',
      restaurantId: 'rest-1',
      memberId: null,
      phoneE164: '85299999999',
      category: 'marketing',
      source: 'whatsapp_keyword',
    })
    expect(r.snapshot.status).toBe('pending')
    expect(r.snapshot.consentGrade).toBe('strong')
    expect(r.snapshot.revokedAt).toBeNull()
  })
})

describe('ConsentRecord.revoke', () => {
  it('flips status to opted_out and stamps revoked_at', () => {
    const granted = ConsentRecord.grant(buildGrant())
    const at = new Date('2026-05-05T10:00:00.000Z')
    const revoked = granted.revoke(at)
    expect(revoked.snapshot.status).toBe('opted_out')
    expect(revoked.snapshot.revokedAt).toBe(at.toISOString())
    // Captured_at must be preserved — the revoke does not rewrite history.
    expect(revoked.snapshot.capturedAt).toBe(granted.snapshot.capturedAt)
  })

  it('is idempotent on an already-opted_out record (returns same instance)', () => {
    const granted = ConsentRecord.grant(buildGrant())
    const at = new Date('2026-05-05T10:00:00.000Z')
    const revoked = granted.revoke(at)
    const second = revoked.revoke(new Date('2026-05-06T10:00:00.000Z'))
    expect(second).toBe(revoked)
    // First-revocation timestamp wins so the audit trail is stable.
    expect(second.snapshot.revokedAt).toBe(at.toISOString())
  })

  it('promotes a pending record to opted_out', () => {
    const pending = ConsentRecord.markPending({
      id: '33333333-3333-3333-3333-333333333333',
      restaurantId: 'rest-1',
      memberId: null,
      phoneE164: '85299999999',
      category: 'marketing',
      source: 'whatsapp_keyword',
    })
    const revoked = pending.revoke(new Date('2026-05-05T10:00:00.000Z'))
    expect(revoked.snapshot.status).toBe('opted_out')
  })
})
