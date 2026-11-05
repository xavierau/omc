import { describe, it, expect } from 'vitest'
import {
  parseWebFormSubmission,
  buildContactFormUrl,
  WEB_FORM_POST_KEYS,
  CONTACT_FORM_TOKEN_TTL_MS,
  CLIENT_NAME_MAX_LEN,
} from '../contact-web-form'
import { CONTACT_FORM_SUBMISSION_KEYS } from '../contact-form-submission'

const TOPICS = ['訂座查詢', '其他查詢']
const PHONE = '+85291234567'

describe('parseWebFormSubmission', () => {
  it('builds the same submission shape the Flow path produces', () => {
    const result = parseWebFormSubmission(
      { clientName: '陳大文', topic: '訂座查詢' },
      PHONE,
      TOPICS
    )

    expect(result).toEqual({
      ok: true,
      submission: { clientName: '陳大文', clientWhatsapp: PHONE, topic: '訂座查詢' },
    })
  })

  // Matches the Flow's editable phone TextInput: a customer may want the
  // callback on a different number than the handset they messaged from. The
  // AUTHENTICATED sender is still the token's phone, reported separately as
  // senderWaId, and buildContactEmail flags the difference.
  it('takes the callback number from the body when supplied', () => {
    const result = parseWebFormSubmission(
      { clientName: '陳大文', topic: '訂座查詢', clientWhatsapp: '+85299999999' },
      PHONE,
      TOPICS
    )

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.submission.clientWhatsapp).toBe('+85299999999')
  })

  // The form starts this field empty and required, so an absent value means a
  // client that bypassed the form. Falling back to the authenticated sender
  // still beats rejecting a real enquiry, and can only resolve to the number
  // we already know.
  it.each([[undefined], [''], ['   ']])(
    'falls back to the token phone when the body value is %s',
    (value) => {
      const result = parseWebFormSubmission(
        { clientName: '陳大文', topic: '訂座查詢', clientWhatsapp: value },
        PHONE,
        TOPICS
      )

      expect(result.ok).toBe(true)
      if (result.ok) expect(result.submission.clientWhatsapp).toBe(PHONE)
    }
  )

  it('rejects an over-long callback number', () => {
    const result = parseWebFormSubmission(
      { clientName: '陳大文', topic: '訂座查詢', clientWhatsapp: '9'.repeat(31) },
      PHONE,
      TOPICS
    )
    expect(result).toEqual({ ok: false, reason: 'clientWhatsapp_too_long' })
  })

  it('trims whitespace on the accepted fields', () => {
    const result = parseWebFormSubmission({ clientName: '  陳大文  ', topic: '訂座查詢' }, PHONE, TOPICS)

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.submission.clientName).toBe('陳大文')
  })

  it.each([
    ['missing name', { topic: '訂座查詢' }, 'missing_clientName'],
    ['blank name', { clientName: '   ', topic: '訂座查詢' }, 'missing_clientName'],
    ['missing topic', { clientName: '陳大文' }, 'missing_topic'],
    ['non-string name', { clientName: 42, topic: '訂座查詢' }, 'missing_clientName'],
  ])('rejects %s', (_label, body, reason) => {
    expect(parseWebFormSubmission(body, PHONE, TOPICS)).toEqual({ ok: false, reason })
  })

  it.each([[null], [undefined], ['a string'], [[]]])('rejects a non-object body (%s)', (body) => {
    expect(parseWebFormSubmission(body, PHONE, TOPICS)).toEqual({
      ok: false,
      reason: 'body_not_object',
    })
  })

  // A free-text topic would make the web form a weaker contract than the Flow
  // Dropdown it stands in for, and the value lands in the restaurant's inbox.
  it('rejects a topic outside the tenant configured set', () => {
    expect(parseWebFormSubmission({ clientName: '陳大文', topic: '任意內容' }, PHONE, TOPICS)).toEqual(
      { ok: false, reason: 'topic_not_allowed' }
    )
  })

  it('rejects an over-long name', () => {
    const result = parseWebFormSubmission(
      { clientName: 'a'.repeat(CLIENT_NAME_MAX_LEN + 1), topic: '訂座查詢' },
      PHONE,
      TOPICS
    )
    expect(result).toEqual({ ok: false, reason: 'clientName_too_long' })
  })
})

describe('WEB_FORM_POST_KEYS', () => {
  // The web form and the Flow must collect the same three fields, or the two
  // channels produce different enquiries for the same tenant.
  it('is exactly the Flow submission keys', () => {
    expect(WEB_FORM_POST_KEYS).toEqual(CONTACT_FORM_SUBMISSION_KEYS)
    expect(WEB_FORM_POST_KEYS).toContain('clientWhatsapp')
  })
})

describe('CONTACT_FORM_TOKEN_TTL_MS', () => {
  // The TTL exists to keep submissions inside WhatsApp's 24-hour service
  // window so the ack is deliverable; a value at or beyond 24h would silently
  // defeat that.
  it('is 30 minutes, comfortably inside the 24-hour service window', () => {
    expect(CONTACT_FORM_TOKEN_TTL_MS).toBe(30 * 60 * 1000)
    expect(CONTACT_FORM_TOKEN_TTL_MS).toBeLessThan(24 * 60 * 60 * 1000)
  })
})

describe('buildContactFormUrl', () => {
  it('builds a token-bearing URL under the tenant slug', () => {
    expect(buildContactFormUrl('https://app.ohmyclient.io', 'kushiro', 'tok123')).toBe(
      'https://app.ohmyclient.io/contact/kushiro?t=tok123'
    )
  })

  it('tolerates a trailing slash on the configured app url', () => {
    expect(buildContactFormUrl('https://app.ohmyclient.io/', 'kushiro', 'tok123')).toBe(
      'https://app.ohmyclient.io/contact/kushiro?t=tok123'
    )
  })

  it('percent-encodes the slug and token', () => {
    expect(buildContactFormUrl('https://x.io', 'a b', 'a+b/c=')).toBe(
      'https://x.io/contact/a%20b?t=a%2Bb%2Fc%3D'
    )
  })

  it.each([
    ['no app url', '', 'kushiro', 'tok'],
    ['no slug', 'https://x.io', '', 'tok'],
    ['no token', 'https://x.io', 'kushiro', ''],
  ])('returns null when %s', (_label, appUrl, slug, token) => {
    expect(buildContactFormUrl(appUrl, slug, token)).toBeNull()
  })
})
