import { describe, it, expect } from 'vitest'
import {
  resolveContactConfig,
  validateContactConfig,
  DEFAULT_TOPICS,
  DEFAULT_ACK_TEXT,
  TOPIC_MAX_LEN,
  ACK_MAX_LEN,
  TOPIC_COUNT,
} from '../contact-config'

const VALID_TOPICS = ['訂座', '外賣', '會員', '意見', '其他']

describe('resolveContactConfig — mode', () => {
  it('defaults to redirect for an empty/undefined/null/junk blob', () => {
    for (const raw of [undefined, null, {}, 'nope', 42, []]) {
      expect(resolveContactConfig(raw).mode).toBe('redirect')
    }
  })

  it('resolves to form only when mode is exactly "form"', () => {
    expect(resolveContactConfig({ mode: 'form' }).mode).toBe('form')
  })

  it('resolves anything else (typo, wrong case, wrong type) to redirect', () => {
    for (const mode of ['Form', 'FORM', 'redirect ', 123, null, {}]) {
      expect(resolveContactConfig({ mode }).mode).toBe('redirect')
    }
  })
})

describe('resolveContactConfig — notificationEmail', () => {
  it('is null when absent', () => {
    expect(resolveContactConfig({}).notificationEmail).toBeNull()
  })

  it('is null for a syntactically invalid email', () => {
    for (const email of ['not-an-email', '@nodomain.com', 'no-at-sign.com', '  ', 42, null]) {
      expect(resolveContactConfig({ notificationEmail: email }).notificationEmail).toBeNull()
    }
  })

  it('trims and returns a syntactically valid email', () => {
    expect(
      resolveContactConfig({ notificationEmail: '  owner@restaurant.hk  ' }).notificationEmail
    ).toBe('owner@restaurant.hk')
  })
})

describe('resolveContactConfig — topics', () => {
  it('defaults to DEFAULT_TOPICS when absent', () => {
    expect(resolveContactConfig({}).topics).toEqual(DEFAULT_TOPICS)
  })

  it('defaults to DEFAULT_TOPICS for a non-array value', () => {
    for (const topics of ['nope', 42, {}, null]) {
      expect(resolveContactConfig({ topics }).topics).toEqual(DEFAULT_TOPICS)
    }
  })

  it('defaults to DEFAULT_TOPICS when there are not exactly 5 entries', () => {
    expect(resolveContactConfig({ topics: VALID_TOPICS.slice(0, 4) }).topics).toEqual(
      DEFAULT_TOPICS
    )
    expect(
      resolveContactConfig({ topics: [...VALID_TOPICS, '額外'] }).topics
    ).toEqual(DEFAULT_TOPICS)
  })

  it('defaults to DEFAULT_TOPICS when any entry is empty', () => {
    const topics = [...VALID_TOPICS.slice(0, 4), '']
    expect(resolveContactConfig({ topics }).topics).toEqual(DEFAULT_TOPICS)
  })

  it('defaults to DEFAULT_TOPICS when any entry exceeds the max length', () => {
    const topics = [...VALID_TOPICS.slice(0, 4), 'x'.repeat(TOPIC_MAX_LEN + 1)]
    expect(resolveContactConfig({ topics }).topics).toEqual(DEFAULT_TOPICS)
  })

  it('defaults to DEFAULT_TOPICS when two entries duplicate', () => {
    const topics = [...VALID_TOPICS.slice(0, 4), VALID_TOPICS[0]]
    expect(resolveContactConfig({ topics }).topics).toEqual(DEFAULT_TOPICS)
  })

  it('keeps a valid 5-entry topic list (trimmed)', () => {
    const topics = VALID_TOPICS.map((t) => `  ${t}  `)
    expect(resolveContactConfig({ topics }).topics).toEqual(VALID_TOPICS)
  })

  it('allows a topic exactly at the max length', () => {
    const topics = [...VALID_TOPICS.slice(0, 4), 'x'.repeat(TOPIC_MAX_LEN)]
    expect(resolveContactConfig({ topics }).topics).toEqual(topics)
  })
})

describe('resolveContactConfig — ackText', () => {
  it('is null when absent', () => {
    expect(resolveContactConfig({}).ackText).toBeNull()
  })

  it('is null for non-string / empty-after-trim values', () => {
    for (const ackText of [42, null, '   ']) {
      expect(resolveContactConfig({ ackText }).ackText).toBeNull()
    }
  })

  it('trims stored ackText', () => {
    expect(resolveContactConfig({ ackText: '  hello  ' }).ackText).toBe('hello')
  })

  it('clamps over-length stored ackText to ACK_MAX_LEN', () => {
    const long = 'a'.repeat(ACK_MAX_LEN + 50)
    expect(resolveContactConfig({ ackText: long }).ackText).toHaveLength(ACK_MAX_LEN)
  })
})

describe('validateContactConfig', () => {
  it('accepts a fully valid form config', () => {
    const result = validateContactConfig({
      mode: 'form',
      notificationEmail: 'owner@restaurant.hk',
      topics: VALID_TOPICS,
      ackText: '多謝查詢',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.config).toEqual({
      mode: 'form',
      notificationEmail: 'owner@restaurant.hk',
      topics: VALID_TOPICS,
      ackText: '多謝查詢',
    })
  })

  it('accepts a valid redirect config with exactly 5 topics', () => {
    const result = validateContactConfig({ mode: 'redirect', topics: VALID_TOPICS })
    expect(result.ok).toBe(true)
  })

  it('accepts redirect mode with no topics at all (topics optional outside form mode)', () => {
    const result = validateContactConfig({ mode: 'redirect' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.config.topics).toEqual(DEFAULT_TOPICS)
  })

  it('accepts redirect mode with null or empty-array topics', () => {
    expect(validateContactConfig({ mode: 'redirect', topics: null }).ok).toBe(true)
    expect(validateContactConfig({ mode: 'redirect', topics: [] }).ok).toBe(true)
  })

  it('rejects redirect mode when 3 topics are supplied (shape still validated if present)', () => {
    const result = validateContactConfig({
      mode: 'redirect',
      topics: VALID_TOPICS.slice(0, 3),
    })
    expect(result.ok).toBe(false)
  })

  it('rejects form mode with no topics at all (topics required in form mode)', () => {
    const result = validateContactConfig({
      mode: 'form',
      notificationEmail: 'owner@restaurant.hk',
    })
    expect(result.ok).toBe(false)
  })

  it('rejects form mode without a notificationEmail', () => {
    const result = validateContactConfig({ mode: 'form', topics: VALID_TOPICS })
    expect(result.ok).toBe(false)
  })

  it('rejects form mode with a syntactically invalid notificationEmail', () => {
    const result = validateContactConfig({
      mode: 'form',
      notificationEmail: 'not-an-email',
      topics: VALID_TOPICS,
    })
    expect(result.ok).toBe(false)
  })

  it.each([
    ['fewer than 5', VALID_TOPICS.slice(0, 4)],
    ['more than 5', [...VALID_TOPICS, '額外']],
    ['containing an empty entry', [...VALID_TOPICS.slice(0, 4), '']],
    ['containing a >30-char entry', [...VALID_TOPICS.slice(0, 4), 'x'.repeat(TOPIC_MAX_LEN + 1)]],
    ['containing a duplicate', [...VALID_TOPICS.slice(0, 4), VALID_TOPICS[0]]],
  ])('rejects topics %s', (_label, topics) => {
    const result = validateContactConfig({ mode: 'redirect', topics })
    expect(result.ok).toBe(false)
  })

  it('rejects ackText over ACK_MAX_LEN', () => {
    const result = validateContactConfig({
      mode: 'redirect',
      topics: VALID_TOPICS,
      ackText: 'a'.repeat(ACK_MAX_LEN + 1),
    })
    expect(result.ok).toBe(false)
  })

  it('allows ackText exactly at ACK_MAX_LEN', () => {
    const result = validateContactConfig({
      mode: 'redirect',
      topics: VALID_TOPICS,
      ackText: 'a'.repeat(ACK_MAX_LEN),
    })
    expect(result.ok).toBe(true)
  })
})

describe('constants', () => {
  it('exposes the expected caps', () => {
    expect(TOPIC_COUNT).toBe(5)
    expect(TOPIC_MAX_LEN).toBe(30)
    expect(ACK_MAX_LEN).toBe(1024)
    expect(DEFAULT_TOPICS).toHaveLength(5)
    expect(typeof DEFAULT_ACK_TEXT).toBe('string')
  })
})
