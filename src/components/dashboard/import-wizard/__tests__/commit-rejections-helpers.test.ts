import { describe, it, expect } from 'vitest'
import {
  groupRejectionsByReason,
  toRejectionsCsv,
  toClipboardText,
} from '../commit-rejections-helpers'

describe('groupRejectionsByReason — T-F2.1', () => {
  it('groups rejections by reason, in the fixed order, with correct per-group counts', () => {
    const rejected = [
      { phoneE164: '+85291111111', reason: 'duplicate_active' as const },
      { phoneE164: '+85292222222', reason: 'invalid_phone' as const },
      { phoneE164: '+85293333333', reason: 'invalid_phone' as const },
      { phoneE164: '+85294444444', reason: 'phone_already_member' as const },
    ]

    const groups = groupRejectionsByReason(rejected)

    expect(groups.map((g) => g.reason)).toEqual([
      'invalid_phone',
      'phone_already_member',
      'duplicate_active',
    ])
    expect(groups.find((g) => g.reason === 'invalid_phone')?.rows.length).toBe(2)
    expect(groups.find((g) => g.reason === 'phone_already_member')?.rows.length).toBe(1)
    expect(groups.find((g) => g.reason === 'duplicate_active')?.rows.length).toBe(1)
  })

  it('omits reasons with zero rows', () => {
    const rejected = [{ phoneE164: '+85291111111', reason: 'invalid_phone' as const }]
    const groups = groupRejectionsByReason(rejected)
    expect(groups.map((g) => g.reason)).toEqual(['invalid_phone'])
  })

  it('places a reason outside the fixed four at the end, alphabetically', () => {
    const rejected = [
      { phoneE164: '+85291111111', reason: 'zzz_future_reason' } as never,
      { phoneE164: '+85292222222', reason: 'aaa_other_reason' } as never,
      { phoneE164: '+85293333333', reason: 'duplicate_phone_in_batch' as const },
    ]
    const groups = groupRejectionsByReason(rejected)
    expect(groups.map((g) => g.reason)).toEqual([
      'duplicate_phone_in_batch',
      'aaa_other_reason',
      'zzz_future_reason',
    ])
  })

  it('empty input → empty array', () => {
    expect(groupRejectionsByReason([])).toEqual([])
  })
})

describe('toRejectionsCsv — T-F2.2', () => {
  it('emits a quoted header row and one quoted row per rejection, CRLF-joined', () => {
    const csv = toRejectionsCsv([
      { phoneE164: '+85291111111', reason: 'invalid_phone' as const, message: 'bad format' },
    ])
    const lines = csv.split('\r\n')
    expect(lines[0]).toBe('"phone","reason","message"')
    expect(lines[1]).toBe('"+85291111111","invalid_phone","bad format"')
  })

  it('doubles internal quotes and leaves commas intact inside a quoted field', () => {
    const csv = toRejectionsCsv([
      {
        phoneE164: '+85291111111',
        reason: 'invalid_phone' as const,
        message: 'has "quotes", and a comma',
      },
    ])
    const lines = csv.split('\r\n')
    expect(lines[1]).toBe('"+85291111111","invalid_phone","has ""quotes"", and a comma"')
  })

  it('a missing message renders as an empty quoted field', () => {
    const csv = toRejectionsCsv([{ phoneE164: '+85291111111', reason: 'invalid_phone' as const }])
    const lines = csv.split('\r\n')
    expect(lines[1]).toBe('"+85291111111","invalid_phone",""')
  })

  it('empty input → header row only', () => {
    expect(toRejectionsCsv([])).toBe('"phone","reason","message"')
  })
})

describe('toClipboardText — T-F2.3 (helper half)', () => {
  it('emits one tab-separated phone/reason/message line per row, newline-joined', () => {
    const text = toClipboardText([
      { phoneE164: '+85291111111', reason: 'invalid_phone' as const, message: 'bad' },
      { phoneE164: '+85292222222', reason: 'duplicate_active' as const },
    ])
    expect(text).toBe('+85291111111\tinvalid_phone\tbad\n+85292222222\tduplicate_active\t')
  })

  it('empty input → empty string', () => {
    expect(toClipboardText([])).toBe('')
  })
})
