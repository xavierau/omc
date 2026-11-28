import { describe, it, expect } from 'vitest'
import {
  validateImageFile,
  buildCampaignImagePath,
} from '../campaign-image-uploader-helpers'

describe('validateImageFile', () => {
  it('accepts a 1MB jpeg', () => {
    expect(
      validateImageFile({ size: 1_000_000, type: 'image/jpeg' })
    ).toBeNull()
  })

  it('accepts png and webp', () => {
    expect(validateImageFile({ size: 1000, type: 'image/png' })).toBeNull()
    expect(validateImageFile({ size: 1000, type: 'image/webp' })).toBeNull()
  })

  it('rejects files > 5MB', () => {
    expect(
      validateImageFile({ size: 5 * 1024 * 1024 + 1, type: 'image/jpeg' })
    ).toEqual({ kind: 'tooLarge' })
  })

  it('rejects non-image mimes', () => {
    expect(
      validateImageFile({ size: 1000, type: 'application/pdf' })
    ).toEqual({ kind: 'wrongType' })
  })

  it('rejects gif (not in allowlist)', () => {
    expect(validateImageFile({ size: 1000, type: 'image/gif' })).toEqual({
      kind: 'wrongType',
    })
  })
})

describe('buildCampaignImagePath', () => {
  it('builds tenant/campaign/lang.ext path', () => {
    expect(
      buildCampaignImagePath({
        restaurantId: 'r-1',
        campaignId: 'camp-7',
        lang: 'en',
        mime: 'image/png',
      })
    ).toBe('r-1/camp-7/en.png')
  })

  it('normalizes image/jpeg to .jpg', () => {
    expect(
      buildCampaignImagePath({
        restaurantId: 'r-1',
        campaignId: 'camp-7',
        lang: 'zhHk',
        mime: 'image/jpeg',
      })
    ).toBe('r-1/camp-7/zhHk.jpg')
  })

  it('falls back to png (never "bin") when mime is not in the allowlist', () => {
    expect(
      buildCampaignImagePath({
        restaurantId: 'r-1',
        campaignId: 'camp-7',
        lang: 'en',
        mime: 'application/octet-stream',
      })
    ).toBe('r-1/camp-7/en.png')
  })

  it('uses "draft-{nonce}" when campaignId is null and draftNonce is provided (create-new flow)', () => {
    expect(
      buildCampaignImagePath({
        restaurantId: 'r-1',
        campaignId: null,
        draftNonce: 'abc12345',
        lang: 'en',
        mime: 'image/webp',
      })
    ).toBe('r-1/draft-abc12345/en.webp')
  })

  it('two separate draft sessions produce different paths (collision guard)', () => {
    const a = buildCampaignImagePath({
      restaurantId: 'r-1',
      campaignId: null,
      draftNonce: 'nonce-a1',
      lang: 'en',
      mime: 'image/png',
    })
    const b = buildCampaignImagePath({
      restaurantId: 'r-1',
      campaignId: null,
      draftNonce: 'nonce-b2',
      lang: 'en',
      mime: 'image/png',
    })
    expect(a).not.toBe(b)
  })

  it('prefers campaignId over draftNonce when both supplied (edit flow)', () => {
    expect(
      buildCampaignImagePath({
        restaurantId: 'r-1',
        campaignId: 'camp-9',
        draftNonce: 'should-not-use',
        lang: 'en',
        mime: 'image/png',
      })
    ).toBe('r-1/camp-9/en.png')
  })
})
