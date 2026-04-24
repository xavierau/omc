import { describe, it, expect } from 'vitest'
import {
  buildUploadPath,
  assertTenantPrefix,
  TenantPrefixError,
} from '../upload-path'

describe('buildUploadPath', () => {
  it('uses caller-supplied path when it starts with restaurantId', () => {
    const path = buildUploadPath({
      restaurantId: 'r-1',
      explicitPath: 'r-1/camp-1/en.png',
      mime: 'image/png',
    })
    expect(path).toBe('r-1/camp-1/en.png')
  })

  it('falls back to tenant-scoped timestamped path when explicitPath is empty', () => {
    const path = buildUploadPath({
      restaurantId: 'r-1',
      explicitPath: '',
      mime: 'image/png',
      now: () => 1700000000000,
    })
    expect(path).toBe('r-1/1700000000000.png')
  })

  it('normalizes image/jpeg to .jpg extension', () => {
    const path = buildUploadPath({
      restaurantId: 'r-1',
      explicitPath: '',
      mime: 'image/jpeg',
      now: () => 1700000000000,
    })
    expect(path).toBe('r-1/1700000000000.jpg')
  })
})

describe('assertTenantPrefix', () => {
  it('accepts explicit path whose first folder matches restaurantId', () => {
    expect(() => assertTenantPrefix('r-1/camp-1/en.png', 'r-1')).not.toThrow()
  })

  it('rejects explicit path whose first folder is a different tenant', () => {
    expect(() => assertTenantPrefix('r-2/camp-1/en.png', 'r-1')).toThrow(
      TenantPrefixError
    )
  })

  it('rejects path with no folder structure', () => {
    expect(() => assertTenantPrefix('en.png', 'r-1')).toThrow(TenantPrefixError)
  })

  it('rejects empty path', () => {
    expect(() => assertTenantPrefix('', 'r-1')).toThrow(TenantPrefixError)
  })

  // FIX 6: traversal + control-char hardening.
  it('rejects path with ".." as a segment (traversal)', () => {
    expect(() => assertTenantPrefix('r-1/../other/en.png', 'r-1')).toThrow(
      TenantPrefixError
    )
  })

  it('rejects path containing a control character', () => {
    expect(() => assertTenantPrefix('r-1/camp\x01/en.png', 'r-1')).toThrow(
      TenantPrefixError
    )
  })

  it('rejects path containing a newline', () => {
    expect(() => assertTenantPrefix('r-1/camp\n/en.png', 'r-1')).toThrow(
      TenantPrefixError
    )
  })

  it('rejects path with leading slash', () => {
    expect(() => assertTenantPrefix('/r-1/camp/en.png', 'r-1')).toThrow(
      TenantPrefixError
    )
  })

  it('rejects path with trailing slash', () => {
    expect(() => assertTenantPrefix('r-1/camp/en.png/', 'r-1')).toThrow(
      TenantPrefixError
    )
  })
})
