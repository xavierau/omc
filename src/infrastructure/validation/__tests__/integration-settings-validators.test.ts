import { describe, it, expect } from 'vitest'
import { parseSettingsPatch, isValidOutboundSecret } from '../integration-settings-validators'

describe('parseSettingsPatch', () => {
  it('rejects a non-object body', () => {
    expect(parseSettingsPatch('nope')).toEqual({ ok: false, error: 'invalid_body' })
    expect(parseSettingsPatch(null)).toEqual({ ok: false, error: 'invalid_body' })
    expect(parseSettingsPatch([1, 2])).toEqual({ ok: false, error: 'invalid_body' })
  })

  it('rejects any key outside the allowlist with 400 unknown_field', () => {
    const result = parseSettingsPatch({ outboundUrl: 'https://x.example.com', restaurantId: 'other-tenant' })
    expect(result).toEqual({ ok: false, error: 'unknown_field', field: 'restaurantId' })
  })

  it('accepts an empty patch', () => {
    expect(parseSettingsPatch({})).toEqual({ ok: true, data: {} })
  })

  it.each([
    ['newJoinTemplateId', { newJoinTemplateId: 123 }],
    ['newJoinTemplateId (bad format)', { newJoinTemplateId: 'not-a-uuid-or-default' }],
    ['consentAttestationText', { consentAttestationText: 42 }],
    ['consentAttestationAck', { consentAttestationAck: 'yes' }],
    ['outboundUrl (not string)', { outboundUrl: 42 }],
    ['outboundUrl (empty)', { outboundUrl: '  ' }],
    ['outboundEvents (not array)', { outboundEvents: 'member.created' }],
    ['outboundEvents (bad entry)', { outboundEvents: ['ping'] }],
    ['outboundEnabled', { outboundEnabled: 'true' }],
    ['outboundPiiAck', { outboundPiiAck: 1 }],
  ])('rejects an invalid %s', (_label, body) => {
    const result = parseSettingsPatch(body)
    expect(result.ok).toBe(false)
  })

  it('accepts newJoinTemplateId as null, "default", or a uuid', () => {
    expect(parseSettingsPatch({ newJoinTemplateId: null }).ok).toBe(true)
    expect(parseSettingsPatch({ newJoinTemplateId: 'default' }).ok).toBe(true)
    expect(parseSettingsPatch({ newJoinTemplateId: '11111111-1111-1111-1111-111111111111' }).ok).toBe(true)
  })

  it('accepts a full valid patch', () => {
    const result = parseSettingsPatch({
      newJoinTemplateId: 'default',
      consentAttestationText: 'We collect...',
      consentAttestationAck: true,
      outboundUrl: 'https://partner.example.com/webhook',
      outboundEvents: ['member.created', 'member.updated'],
      outboundEnabled: true,
      outboundPiiAck: true,
    })
    expect(result.ok).toBe(true)
  })
})

describe('isValidOutboundSecret', () => {
  it('rejects shorter than 16 characters and non-strings', () => {
    expect(isValidOutboundSecret('short')).toBe(false)
    expect(isValidOutboundSecret('')).toBe(false)
    expect(isValidOutboundSecret(undefined)).toBe(false)
    expect(isValidOutboundSecret(12345678901234567890)).toBe(false)
  })

  it('accepts 16+ characters', () => {
    expect(isValidOutboundSecret('a'.repeat(16))).toBe(true)
    expect(isValidOutboundSecret('a'.repeat(40))).toBe(true)
  })
})
