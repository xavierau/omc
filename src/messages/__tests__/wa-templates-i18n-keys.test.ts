import { describe, it, expect } from 'vitest'
import en from '../en.json'
import zhHK from '../zh-HK.json'

/**
 * TPL-011 — locale-parity.test.ts only proves the two files carry the SAME
 * keys, which stays green if a key is deleted from both. This pins the two
 * header-hint keys `HeaderSection` (wa-template-form-fields.tsx) renders.
 */
const REQUIRED_KEYS = ['imageHeaderHint', 'videoHeaderHint'] as const

function readPath(root: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((node, key) => {
    if (node && typeof node === 'object') return (node as Record<string, unknown>)[key]
    return undefined
  }, root)
}

describe('waTemplates header-hint i18n keys (TPL-011)', () => {
  it.each([
    ['en', en],
    ['zh-HK', zhHK],
  ])('%s carries every header-hint key as a non-empty string', (_locale, messages) => {
    const waTemplates = readPath(messages, 'waTemplates')
    const missing = REQUIRED_KEYS.filter((key) => {
      const value = readPath(waTemplates, key)
      return typeof value !== 'string' || value.trim().length === 0
    })
    expect(missing).toEqual([])
  })

  it('the EN video hint mentions 16MB and MP4', () => {
    expect(en.waTemplates.videoHeaderHint).toContain('16MB')
    expect(en.waTemplates.videoHeaderHint).toContain('MP4')
  })
})
