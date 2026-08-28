import { describe, it, expect } from 'vitest'
import en from '@/messages/en.json'
import zhHK from '@/messages/zh-HK.json'

/**
 * T-T0 (plan 2026-08-28-wonb-018-019) — the locale-parity test only proves
 * the two files carry the SAME keys; it stays green if a key is deleted from
 * both. This pins the exact `importWizard.csv` keys the upload step renders
 * (csv-format-help.tsx, csv-parse-rejections.tsx, step-upload-csv.tsx).
 */
const REQUIRED_CSV_KEYS = [
  'description',
  'pick',
  'rowCount',
  'errors.empty',
  'errors.tooManyRows',
  'tagsFound',
  'tagsIgnored',
  'downloadTemplate',
  'help.title',
  'help.phone',
  'help.name',
  'help.language',
  'help.tags',
  'help.limits',
  'rejectedTitle',
  'rejectLine',
  'reason.column_count_mismatch',
  'reason.unterminated_quote',
  'showingFirst',
] as const

function readPath(root: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((node, key) => {
    if (node && typeof node === 'object') return (node as Record<string, unknown>)[key]
    return undefined
  }, root)
}

describe('importWizard.csv i18n keys (T-T0)', () => {
  it.each([
    ['en', en],
    ['zh-HK', zhHK],
  ])('%s carries every key the upload step renders, as a non-empty string', (_locale, messages) => {
    const csv = readPath(messages, 'importWizard.csv')
    const missing = REQUIRED_CSV_KEYS.filter((key) => {
      const value = readPath(csv, key)
      return typeof value !== 'string' || value.trim().length === 0
    })
    expect(missing).toEqual([])
  })

  it('help.tags and help.limits carry the interpolation params the component passes', () => {
    for (const messages of [en, zhHK]) {
      expect(readPath(messages, 'importWizard.csv.help.tags')).toContain('{maxTagsPerRow}')
      expect(readPath(messages, 'importWizard.csv.help.limits')).toContain('{maxRows}')
      expect(readPath(messages, 'importWizard.csv.reason.column_count_mismatch')).toContain('{expected}')
      expect(readPath(messages, 'importWizard.csv.reason.column_count_mismatch')).toContain('{actual}')
    }
  })
})
