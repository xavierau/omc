import { describe, it, expect } from 'vitest'
import { parseContactFormSubmission } from '../contact-form-submission'

describe('parseContactFormSubmission', () => {
  it('parses a well-formed flow_response payload (camelCase — the Flow JSON authoring case)', () => {
    const result = parseContactFormSubmission({
      clientName: '陳大文',
      clientWhatsapp: '+852 9123 4567',
      topic: '訂座查詢',
    })

    expect(result).toEqual({
      ok: true,
      submission: {
        clientName: '陳大文',
        clientWhatsapp: '+852 9123 4567',
        topic: '訂座查詢',
      },
    })
  })

  it('trims whitespace-padded field values', () => {
    const result = parseContactFormSubmission({
      clientName: '  Alice  ',
      clientWhatsapp: ' 85291234567 ',
      topic: ' 其他查詢 ',
    })

    expect(result).toEqual({
      ok: true,
      submission: {
        clientName: 'Alice',
        clientWhatsapp: '85291234567',
        topic: '其他查詢',
      },
    })
  })

  it('rejects a non-object payload', () => {
    expect(parseContactFormSubmission(undefined)).toEqual({
      ok: false,
      reason: expect.any(String),
    })
    expect(parseContactFormSubmission(null)).toEqual({
      ok: false,
      reason: expect.any(String),
    })
    expect(parseContactFormSubmission('not-an-object')).toEqual({
      ok: false,
      reason: expect.any(String),
    })
    expect(parseContactFormSubmission(['a', 'b'])).toEqual({
      ok: false,
      reason: expect.any(String),
    })
  })

  it('rejects a payload missing clientName', () => {
    const result = parseContactFormSubmission({
      clientWhatsapp: '85291234567',
      topic: '訂座查詢',
    })
    expect(result.ok).toBe(false)
  })

  it('rejects a payload missing clientWhatsapp', () => {
    const result = parseContactFormSubmission({
      clientName: 'Alice',
      topic: '訂座查詢',
    })
    expect(result.ok).toBe(false)
  })

  it('rejects a payload missing topic', () => {
    const result = parseContactFormSubmission({
      clientName: 'Alice',
      clientWhatsapp: '85291234567',
    })
    expect(result.ok).toBe(false)
  })

  it('rejects empty-string field values', () => {
    const result = parseContactFormSubmission({
      clientName: '',
      clientWhatsapp: '85291234567',
      topic: '訂座查詢',
    })
    expect(result.ok).toBe(false)
  })

  it('rejects whitespace-only field values', () => {
    const result = parseContactFormSubmission({
      clientName: '   ',
      clientWhatsapp: '85291234567',
      topic: '訂座查詢',
    })
    expect(result.ok).toBe(false)
  })

  it('rejects non-string field values', () => {
    const result = parseContactFormSubmission({
      clientName: 123,
      clientWhatsapp: '85291234567',
      topic: '訂座查詢',
    })
    expect(result.ok).toBe(false)
  })

  it('rejects an entirely unrelated shape (e.g. another flow response)', () => {
    const result = parseContactFormSubmission({ some_other_field: 'x' })
    expect(result.ok).toBe(false)
  })

  it('rejects the old snake_case keys — regression guard: the Flow JSON forces camelCase field names, snake_case never arrives on the wire', () => {
    const result = parseContactFormSubmission({
      client_name: 'Alice',
      client_whatsapp: '85291234567',
      topic: '訂座查詢',
    })
    expect(result.ok).toBe(false)
  })
})
