import { describe, it, expect } from 'vitest'
import {
  resolveContactConfig,
  validateContactConfig,
  DEFAULT_TOPICS,
  DEFAULT_ACK_TEXT,
  DEFAULT_LABELS,
  TOPIC_MAX_LEN,
  ACK_MAX_LEN,
  TOPIC_COUNT,
  LABEL_TITLE_MAX_LEN,
  LABEL_MAX_LEN,
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

describe('validateContactConfig — non-object payloads', () => {
  // A PATCH body that isn't a JSON object must be rejected outright — unlike
  // `resolveContactConfig` (the read side, tested above), which must keep
  // degrading silently to redirect-mode defaults so a malformed stored blob
  // never breaks a read. Silently accepting a malformed *write* here would
  // overwrite a tenant's real settings with defaults.
  it.each([
    ['null', null],
    ['a number', 42],
    ['an array', []],
    ['a bare string', 'str'],
  ])('rejects %s', (_label, raw) => {
    const result = validateContactConfig(raw)
    expect(result.ok).toBe(false)
  })

  it('resolveContactConfig still degrades the same non-object inputs to redirect-mode defaults', () => {
    for (const raw of [null, 42, [], 'str']) {
      const config = resolveContactConfig(raw)
      expect(config.mode).toBe('redirect')
      expect(config.notificationEmail).toBeNull()
      expect(config.topics).toEqual(DEFAULT_TOPICS)
    }
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
      labels: DEFAULT_LABELS,
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

describe('resolveContactConfig — labels', () => {
  it('defaults to DEFAULT_LABELS when absent', () => {
    expect(resolveContactConfig({}).labels).toEqual(DEFAULT_LABELS)
  })

  it('defaults to DEFAULT_LABELS for a non-object labels value', () => {
    for (const labels of ['nope', 42, null, []]) {
      expect(resolveContactConfig({ labels }).labels).toEqual(DEFAULT_LABELS)
    }
  })

  it('defaults to DEFAULT_LABELS for an empty object', () => {
    expect(resolveContactConfig({ labels: {} }).labels).toEqual(DEFAULT_LABELS)
  })

  it.each(['title', 'nameLabel', 'phoneLabel', 'topicLabel', 'submitLabel'] as const)(
    'falls back to the default %s only, leaving sibling fields untouched, when that field is empty/whitespace/non-string',
    (field) => {
      const sibling = field === 'nameLabel' ? 'phoneLabel' : 'nameLabel'
      for (const value of ['', '   ', 42, null]) {
        const labels = resolveContactConfig({
          labels: { [field]: value, [sibling]: '自訂值' },
        }).labels
        expect(labels[field]).toBe(DEFAULT_LABELS[field])
        expect(labels[sibling]).toBe('自訂值')
      }
    }
  )

  it('trims and keeps a valid custom label per field', () => {
    const custom = {
      title: '  歡迎查詢  ',
      nameLabel: '  客戶姓名  ',
      phoneLabel: '  電話號碼  ',
      topicLabel: '  查詢類別  ',
      submitLabel: '  送出  ',
    }
    expect(resolveContactConfig({ labels: custom }).labels).toEqual({
      title: '歡迎查詢',
      nameLabel: '客戶姓名',
      phoneLabel: '電話號碼',
      topicLabel: '查詢類別',
      submitLabel: '送出',
    })
  })

  it('clamps an over-length title to LABEL_TITLE_MAX_LEN', () => {
    const long = 'x'.repeat(LABEL_TITLE_MAX_LEN + 10)
    expect(resolveContactConfig({ labels: { title: long } }).labels.title).toHaveLength(
      LABEL_TITLE_MAX_LEN
    )
  })

  it.each(['nameLabel', 'phoneLabel', 'topicLabel', 'submitLabel'] as const)(
    'clamps an over-length %s to LABEL_MAX_LEN',
    (field) => {
      const long = 'x'.repeat(LABEL_MAX_LEN + 10)
      expect(resolveContactConfig({ labels: { [field]: long } }).labels[field]).toHaveLength(
        LABEL_MAX_LEN
      )
    }
  )

  it('a stored config with no labels key (pre-REPLY-007) resolves to DEFAULT_LABELS', () => {
    const legacyStoredBlob = {
      mode: 'form',
      notificationEmail: 'owner@restaurant.hk',
      topics: VALID_TOPICS,
      ackText: '多謝查詢',
    }
    expect(resolveContactConfig(legacyStoredBlob).labels).toEqual(DEFAULT_LABELS)
  })
})

describe('validateContactConfig — labels', () => {
  it('accepts a payload with labels omitted entirely', () => {
    const result = validateContactConfig({ mode: 'redirect', topics: VALID_TOPICS })
    expect(result.ok).toBe(true)
  })

  it('accepts valid custom labels and round-trips them', () => {
    const labels = {
      title: '歡迎查詢',
      nameLabel: '客戶姓名',
      phoneLabel: '電話號碼',
      topicLabel: '查詢類別',
      submitLabel: '送出',
    }
    const result = validateContactConfig({ mode: 'redirect', topics: VALID_TOPICS, labels })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.config.labels).toEqual(labels)
  })

  it.each([
    ['title', LABEL_TITLE_MAX_LEN],
    ['nameLabel', LABEL_MAX_LEN],
    ['phoneLabel', LABEL_MAX_LEN],
    ['topicLabel', LABEL_MAX_LEN],
    ['submitLabel', LABEL_MAX_LEN],
  ] as const)('rejects an over-length %s naming the field', (field, max) => {
    const result = validateContactConfig({
      mode: 'redirect',
      topics: VALID_TOPICS,
      labels: { [field]: 'x'.repeat(max + 1) },
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain(field)
  })

  it('allows a label exactly at its max length', () => {
    const result = validateContactConfig({
      mode: 'redirect',
      topics: VALID_TOPICS,
      labels: { title: 'x'.repeat(LABEL_TITLE_MAX_LEN) },
    })
    expect(result.ok).toBe(true)
  })

  it.each([
    ['title', 123],
    ['nameLabel', true],
    ['phoneLabel', null],
    ['topicLabel', {}],
    ['submitLabel', ['x']],
  ] as const)(
    'rejects a non-string %s naming the field, instead of silently defaulting it (code review L4)',
    (field, value) => {
      const result = validateContactConfig({
        mode: 'redirect',
        topics: VALID_TOPICS,
        labels: { [field]: value },
      })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error).toContain(field)
    }
  )

  it('a field left undefined (not supplied) is still fine — only a wrong-typed present value is rejected', () => {
    const result = validateContactConfig({
      mode: 'redirect',
      topics: VALID_TOPICS,
      labels: { title: '自訂標題', nameLabel: undefined },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.config.labels.nameLabel).toBe(DEFAULT_LABELS.nameLabel)
  })
})

describe('constants', () => {
  it('exposes the expected caps', () => {
    expect(TOPIC_COUNT).toBe(5)
    expect(TOPIC_MAX_LEN).toBe(30)
    expect(ACK_MAX_LEN).toBe(1024)
    expect(LABEL_TITLE_MAX_LEN).toBe(30)
    expect(LABEL_MAX_LEN).toBe(20)
    expect(DEFAULT_TOPICS).toHaveLength(5)
    expect(typeof DEFAULT_ACK_TEXT).toBe('string')
    expect(DEFAULT_LABELS).toEqual({
      title: '聯絡我們',
      nameLabel: '姓名',
      phoneLabel: 'WhatsApp 號碼',
      topicLabel: '查詢主題',
      submitLabel: '提交',
    })
  })
})
