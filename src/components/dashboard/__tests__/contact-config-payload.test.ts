import { describe, it, expect } from 'vitest'
import {
  buildContactConfigPayload,
  canSaveContactConfig,
  contactConfigValidationError,
  isContactEmailInvalid,
} from '@/components/dashboard/contact-config-payload'

const TOPICS = ['訂座查詢', '外賣及自取', '會員及積分查詢', '意見及投訴', '其他查詢']
const BLANK_TOPICS = ['', '', '', '', '']

describe('canSaveContactConfig', () => {
  it('blocks an empty notification email in form mode', () => {
    expect(canSaveContactConfig({ mode: 'form', notificationEmail: '', topics: TOPICS, ackText: '' })).toBe(false)
  })

  it('blocks a whitespace-only notification email in form mode', () => {
    expect(
      canSaveContactConfig({ mode: 'form', notificationEmail: '   ', topics: TOPICS, ackText: '' })
    ).toBe(false)
  })

  it('allows form mode once a notification email is set', () => {
    expect(
      canSaveContactConfig({ mode: 'form', notificationEmail: 'owner@example.com', topics: TOPICS, ackText: '' })
    ).toBe(true)
  })

  it('allows redirect mode with no notification email', () => {
    expect(canSaveContactConfig({ mode: 'redirect', notificationEmail: '', topics: BLANK_TOPICS, ackText: '' })).toBe(
      true
    )
  })

  it('blocks a malformed notification email in form mode (mirrors server format check)', () => {
    expect(
      canSaveContactConfig({ mode: 'form', notificationEmail: 'not-an-email', topics: TOPICS, ackText: '' })
    ).toBe(false)
  })

  it('blocks a duplicate topic in form mode (mirrors server topic rules)', () => {
    const duplicated = [...TOPICS.slice(0, 4), TOPICS[0]]
    expect(
      canSaveContactConfig({ mode: 'form', notificationEmail: 'owner@example.com', topics: duplicated, ackText: '' })
    ).toBe(false)
  })

  it('blocks a cleared topic in form mode (mirrors server topic rules)', () => {
    const oneCleared = [...TOPICS.slice(0, 4), '']
    expect(
      canSaveContactConfig({ mode: 'form', notificationEmail: 'owner@example.com', topics: oneCleared, ackText: '' })
    ).toBe(false)
  })

  it('allows redirect mode even when topics look invalid — they are stale form-mode leftovers, not an intentional entry, and must never block a redirect save (mode-switch trap, CodeRabbit PR #70)', () => {
    const duplicated = [...TOPICS.slice(0, 4), TOPICS[0]]
    expect(
      canSaveContactConfig({ mode: 'redirect', notificationEmail: '', topics: duplicated, ackText: '' })
    ).toBe(true)
  })

  it('allows redirect mode after partially filling form-mode topics then switching back (reproduces the mode-switch trap: admin fills some topics, flips to redirect, save must succeed)', () => {
    const partiallyFilled = [...TOPICS.slice(0, 2), '', '', '']
    expect(
      canSaveContactConfig({ mode: 'redirect', notificationEmail: '', topics: partiallyFilled, ackText: '' })
    ).toBe(true)
  })

  it('allows redirect mode with untouched (blank) topics — sent as [] and therefore omitted, not validated', () => {
    expect(
      canSaveContactConfig({ mode: 'redirect', notificationEmail: '', topics: BLANK_TOPICS, ackText: '' })
    ).toBe(true)
  })
})

describe('contactConfigValidationError', () => {
  it('returns null when the config is valid', () => {
    expect(
      contactConfigValidationError({ mode: 'form', notificationEmail: 'owner@example.com', topics: TOPICS, ackText: '' })
    ).toBeNull()
  })

  it('returns the domain error string when topics are invalid', () => {
    const oneCleared = [...TOPICS.slice(0, 4), '']
    const error = contactConfigValidationError({
      mode: 'form',
      notificationEmail: 'owner@example.com',
      topics: oneCleared,
      ackText: '',
    })
    expect(error).toContain('topics')
  })

  it('returns the domain error string when the email is missing in form mode', () => {
    const error = contactConfigValidationError({ mode: 'form', notificationEmail: '', topics: TOPICS, ackText: '' })
    expect(error).toBe('notificationEmail is required for form mode')
  })
})

describe('buildContactConfigPayload', () => {
  it('always includes all four keys (PATCH is a full replace)', () => {
    const payload = buildContactConfigPayload({
      mode: 'redirect',
      notificationEmail: '',
      topics: BLANK_TOPICS,
      ackText: '',
    })
    expect(Object.keys(payload).sort()).toEqual(['ackText', 'mode', 'notificationEmail', 'topics'])
  })

  it('sends [] for topics in redirect mode when none were entered', () => {
    const payload = buildContactConfigPayload({
      mode: 'redirect',
      notificationEmail: '',
      topics: BLANK_TOPICS,
      ackText: '',
    })
    expect(payload.topics).toEqual([])
  })

  it('sends [] for topics in redirect mode even when some were partially filled in from a prior form-mode edit', () => {
    const partiallyFilled = [...TOPICS.slice(0, 2), '', '', '']
    const payload = buildContactConfigPayload({
      mode: 'redirect',
      notificationEmail: '',
      topics: partiallyFilled,
      ackText: '',
    })
    expect(payload.topics).toEqual([])
  })

  it('trims and preserves a fully-filled topic list in form mode', () => {
    const payload = buildContactConfigPayload({
      mode: 'form',
      notificationEmail: 'owner@example.com',
      topics: TOPICS.map((t) => `  ${t}  `),
      ackText: '',
    })
    expect(payload.topics).toEqual(TOPICS)
  })

  it('normalizes a blank notification email to null', () => {
    const payload = buildContactConfigPayload({
      mode: 'redirect',
      notificationEmail: '   ',
      topics: BLANK_TOPICS,
      ackText: '',
    })
    expect(payload.notificationEmail).toBeNull()
  })

  it('trims a notification email', () => {
    const payload = buildContactConfigPayload({
      mode: 'form',
      notificationEmail: '  owner@example.com  ',
      topics: TOPICS,
      ackText: '',
    })
    expect(payload.notificationEmail).toBe('owner@example.com')
  })

  it('normalizes a blank ack text to null', () => {
    const payload = buildContactConfigPayload({
      mode: 'redirect',
      notificationEmail: '',
      topics: BLANK_TOPICS,
      ackText: '   ',
    })
    expect(payload.ackText).toBeNull()
  })

  it('trims a custom ack text', () => {
    const payload = buildContactConfigPayload({
      mode: 'form',
      notificationEmail: 'owner@example.com',
      topics: TOPICS,
      ackText: '  Thanks! ',
    })
    expect(payload.ackText).toBe('Thanks!')
  })

  it('passes the mode straight through', () => {
    expect(
      buildContactConfigPayload({ mode: 'form', notificationEmail: 'a@b.com', topics: TOPICS, ackText: '' }).mode
    ).toBe('form')
  })
})

describe('isContactEmailInvalid', () => {
  it('is false in redirect mode regardless of email content (field is hidden and unused)', () => {
    expect(isContactEmailInvalid('redirect', 'not-an-email')).toBe(false)
    expect(isContactEmailInvalid('redirect', '')).toBe(false)
  })

  it('is true for a blank email in form mode', () => {
    expect(isContactEmailInvalid('form', '')).toBe(true)
  })

  it('is true for a whitespace-only email in form mode', () => {
    expect(isContactEmailInvalid('form', '   ')).toBe(true)
  })

  it('is true for a malformed (non-blank) email in form mode — agrees with the server format rule', () => {
    expect(isContactEmailInvalid('form', 'not-an-email')).toBe(true)
  })

  it('is false for a syntactically valid email in form mode', () => {
    expect(isContactEmailInvalid('form', 'owner@example.com')).toBe(false)
  })
})
