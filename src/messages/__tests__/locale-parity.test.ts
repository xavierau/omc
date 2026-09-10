import { describe, it, expect } from 'vitest'
import en from '../en.json'
import zhHK from '../zh-HK.json'

/**
 * Recursively collects every leaf key path in a nested message object,
 * e.g. { importWizard: { csv: { description: '...' } } } -> ['importWizard.csv.description'].
 * Arrays are treated as leaves (not walked further) since no message file uses them.
 */
function collectKeyPaths(node: unknown, prefix = ''): string[] {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) {
    return [prefix]
  }
  const entries = Object.entries(node as Record<string, unknown>)
  return entries.flatMap(([key, value]) =>
    collectKeyPaths(value, prefix ? `${prefix}.${key}` : key)
  )
}

describe('locale parity: en.json vs zh-HK.json', () => {
  it('both files parse as valid JSON objects', () => {
    expect(typeof en).toBe('object')
    expect(typeof zhHK).toBe('object')
  })

  it('have identical key sets (deep)', () => {
    const enKeys = collectKeyPaths(en).sort()
    const zhKeys = collectKeyPaths(zhHK).sort()

    const missingFromZh = enKeys.filter((k) => !zhKeys.includes(k))
    const missingFromEn = zhKeys.filter((k) => !enKeys.includes(k))

    expect(missingFromZh, `keys present in en.json but missing from zh-HK.json`).toEqual([])
    expect(missingFromEn, `keys present in zh-HK.json but missing from en.json`).toEqual([])
    expect(zhKeys).toEqual(enKeys)
  })
})
