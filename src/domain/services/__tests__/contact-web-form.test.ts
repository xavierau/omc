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

  // The security property the whole design rests on: a public POST cannot
  // choose whose enquiry this is. The body value is ignored, not rejected, so
  // a stale or tampered field silently loses to the token.
  it('always takes the phone from the token, ignoring any posted value', () => {
    const result = parseWebFormSubmission(
      { clientName: '陳大文', topic: '訂座查詢', clientWhatsapp: '+85299999999' },
      PHONE,
      TOPICS
    )

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.submission.clientWhatsapp).toBe(PHONE)
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
  it('is the Flow submission keys minus the one the client may never supply', () => {
    expect(WEB_FORM_POST_KEYS).toEqual(
      CONTACT_FORM_SUBMISSION_KEYS.filter((k) => k !== 'clientWhatsapp')
    )
    expect(WEB_FORM_POST_KEYS).not.toContain('clientWhatsapp')
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
