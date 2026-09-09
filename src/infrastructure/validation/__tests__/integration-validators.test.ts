import { describe, it, expect } from 'vitest'
import { parseIntegrationPatch } from '../integration-validators'

describe('parseIntegrationPatch', () => {
  it('accepts an allowlisted field', () => {
    const result = parseIntegrationPatch({ name: 'Updated Name' })

    expect(result).toEqual({ ok: true, data: { name: 'Updated Name' } })
  })

  it('accepts status active', () => {
    const result = parseIntegrationPatch({ status: 'active' })

    expect(result).toEqual({ ok: true, data: { status: 'active' } })
  })

  it('accepts multiple allowlisted fields together', () => {
    const result = parseIntegrationPatch({ name: 'X', status: 'inactive' })

    expect(result).toEqual({ ok: true, data: { name: 'X', status: 'inactive' } })
  })

  it('rejects webhookSecret — the mass-assignment path (T-C4)', () => {
    const result = parseIntegrationPatch({ webhookSecret: 'attacker-chosen-secret' })

    expect(result).toEqual({ ok: false, error: 'unknown_field', field: 'webhookSecret' })
  })

  it('rejects outboundUrl', () => {
    const result = parseIntegrationPatch({ outboundUrl: 'https://evil.example.com' })

    expect(result).toEqual({ ok: false, error: 'unknown_field', field: 'outboundUrl' })
  })

  it('rejects restaurantId (tenant re-parenting attempt)', () => {
    const result = parseIntegrationPatch({ restaurantId: 'some-other-tenant' })

    expect(result).toEqual({ ok: false, error: 'unknown_field', field: 'restaurantId' })
  })

  it('rejects a compound body mixing allowed and disallowed keys', () => {
    const result = parseIntegrationPatch({
      status: 'active',
      webhookSecret: 'attacker-chosen-secret',
      outboundUrl: 'https://evil.example.com',
    })

    expect(result.ok).toBe(false)
    expect(result).toMatchObject({ ok: false, error: 'unknown_field' })
  })

  it('rejects a non-allowlisted arbitrary key', () => {
    const result = parseIntegrationPatch({ isAdmin: true })

    expect(result).toEqual({ ok: false, error: 'unknown_field', field: 'isAdmin' })
  })

  it('rejects a non-object body', () => {
    expect(parseIntegrationPatch(null)).toEqual({ ok: false, error: 'invalid_body' })
    expect(parseIntegrationPatch('str')).toEqual({ ok: false, error: 'invalid_body' })
    expect(parseIntegrationPatch([1, 2])).toEqual({ ok: false, error: 'invalid_body' })
  })

  it('rejects an empty-string name', () => {
    const result = parseIntegrationPatch({ name: '   ' })

    expect(result).toEqual({ ok: false, error: 'invalid_name' })
  })

  it('rejects an invalid status enum value', () => {
    const result = parseIntegrationPatch({ status: 'deleted' })

    expect(result).toEqual({ ok: false, error: 'invalid_status' })
  })

  it('rejects non-object credentials', () => {
    const result = parseIntegrationPatch({ credentials: 'not-an-object' })

    expect(result).toEqual({ ok: false, error: 'invalid_credentials' })
  })

  it('accepts an object credentials value', () => {
    const result = parseIntegrationPatch({ credentials: { apiKey: 'abc' } })

    expect(result).toEqual({ ok: true, data: { credentials: { apiKey: 'abc' } } })
  })

  it('passes fieldMapping through for downstream structural validation', () => {
    const mapping = { transactionId: '$.id' }
    const result = parseIntegrationPatch({ fieldMapping: mapping })

    expect(result).toEqual({ ok: true, data: { fieldMapping: mapping } })
  })

  it('accepts an empty body (no-op patch)', () => {
    const result = parseIntegrationPatch({})

    expect(result).toEqual({ ok: true, data: {} })
  })
})
