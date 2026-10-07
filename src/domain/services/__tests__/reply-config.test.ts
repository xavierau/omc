import { describe, it, expect } from 'vitest'
import {
  resolveReplyConfig,
  validateReplyConfig,
  DEFAULT_REPLY_FEATURES,
  REPLY_TEXT_MAX,
} from '../reply-config'

describe('resolveReplyConfig — features', () => {
  it('defaults every feature ON for an empty/undefined/null blob', () => {
    for (const raw of [undefined, null, {}, 'nope', 42, []]) {
      expect(resolveReplyConfig(raw).features).toEqual(DEFAULT_REPLY_FEATURES)
    }
  })

  it('disables a feature ONLY when explicitly false', () => {
    const { features } = resolveReplyConfig({
      features: { points: false, rewards: true },
    })
    expect(features).toEqual({
      points: false,
      rewards: true,
      redeem: true,
      card: true,
      help: true,
    })
  })

  it('includes help (default ON) and disables it only when explicitly false', () => {
    expect(DEFAULT_REPLY_FEATURES.help).toBe(true)
    expect(resolveReplyConfig({ features: { help: false } }).features.help).toBe(
      false
    )
    // A missing help key (legacy blob predating REPLY-004) stays ON.
    expect(resolveReplyConfig({ features: { points: false } }).features.help).toBe(
      true
    )
  })

  it('leaves a feature ON for non-boolean/missing values', () => {
    const { features } = resolveReplyConfig({
      features: { points: 'off', rewards: null, redeem: 0 },
    })
    expect(features).toEqual(DEFAULT_REPLY_FEATURES)
  })
})

describe('resolveReplyConfig — text', () => {
  it('yields null for every message when no text is stored', () => {
    expect(resolveReplyConfig({}).text).toEqual({
      unknown: { en: null, zh: null },
      help: { en: null, zh: null },
      join: { en: null, zh: null },
    })
  })

  it('trims stored text and coerces empty/whitespace to null', () => {
    const { text } = resolveReplyConfig({
      text: {
        unknown: { en: '  Try again  ', zh: '   ' },
        help: { en: '', zh: '幫助' },
      },
    })
    expect(text.unknown).toEqual({ en: 'Try again', zh: null })
    expect(text.help).toEqual({ en: null, zh: '幫助' })
    expect(text.join).toEqual({ en: null, zh: null })
  })

  it('clamps over-length stored text to the per-message cap', () => {
    const long = 'a'.repeat(REPLY_TEXT_MAX.unknown + 50)
    const { text } = resolveReplyConfig({ text: { unknown: { en: long } } })
    expect(text.unknown.en).toHaveLength(REPLY_TEXT_MAX.unknown)
  })

  it('ignores non-string / non-object text shapes', () => {
    const { text } = resolveReplyConfig({
      text: { unknown: 'flat', help: 123, join: { en: 5, zh: {} } },
    })
    expect(text.unknown).toEqual({ en: null, zh: null })
    expect(text.help).toEqual({ en: null, zh: null })
    expect(text.join).toEqual({ en: null, zh: null })
  })
})

describe('validateReplyConfig', () => {
  it('accepts and normalizes a valid edit', () => {
    const result = validateReplyConfig({
      features: { points: false },
      text: { unknown: { en: '  Hi  ' } },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.config.features.points).toBe(false)
    expect(result.config.text.unknown.en).toBe('Hi')
  })

  it('rejects an over-length message with an error naming the field', () => {
    const result = validateReplyConfig({
      text: { unknown: { en: 'a'.repeat(REPLY_TEXT_MAX.unknown + 1) } },
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('unknown en')
  })

  it('allows text exactly at the cap', () => {
    const result = validateReplyConfig({
      text: { help: { zh: 'x'.repeat(REPLY_TEXT_MAX.help) } },
    })
    expect(result.ok).toBe(true)
  })

  it('is safe for an empty/garbage body (defaults, all ON)', () => {
    const result = validateReplyConfig(undefined)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.config.features).toEqual(DEFAULT_REPLY_FEATURES)
  })
})
