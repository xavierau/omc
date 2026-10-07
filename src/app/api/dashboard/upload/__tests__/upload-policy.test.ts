import { describe, it, expect } from 'vitest'
import { checkUploadPolicy } from '../upload-policy'

const BUCKETS = ['tenant-assets', 'wa-template-media', 'campaign-images'] as const
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const UNKNOWN_MIMES = ['application/octet-stream', 'video/quicktime', 'image/gif']

describe('checkUploadPolicy', () => {
  describe.each(BUCKETS)('bucket=%s', (bucket) => {
    it.each(IMAGE_TYPES)('accepts %s at exactly 5MB', (mime) => {
      expect(checkUploadPolicy({ bucket, mime, size: 5 * 1024 * 1024 })).toBeNull()
    })

    it.each(IMAGE_TYPES)('rejects %s at 5MB + 1 byte', (mime) => {
      expect(checkUploadPolicy({ bucket, mime, size: 5 * 1024 * 1024 + 1 })).toEqual({
        error: 'File exceeds 5MB limit.',
      })
    })
  })

  it('accepts video/mp4 on wa-template-media at exactly 16MB', () => {
    expect(
      checkUploadPolicy({ bucket: 'wa-template-media', mime: 'video/mp4', size: 16 * 1024 * 1024 })
    ).toBeNull()
  })

  it('accepts video/3gpp on wa-template-media at exactly 16MB', () => {
    expect(
      checkUploadPolicy({ bucket: 'wa-template-media', mime: 'video/3gpp', size: 16 * 1024 * 1024 })
    ).toBeNull()
  })

  it('rejects video/mp4 on wa-template-media at 16MB + 1 byte', () => {
    expect(
      checkUploadPolicy({ bucket: 'wa-template-media', mime: 'video/mp4', size: 16 * 1024 * 1024 + 1 })
    ).toEqual({ error: 'File exceeds 16MB limit.' })
  })

  it('rejects video/3gpp on wa-template-media at 16MB + 1 byte', () => {
    expect(
      checkUploadPolicy({ bucket: 'wa-template-media', mime: 'video/3gpp', size: 16 * 1024 * 1024 + 1 })
    ).toEqual({ error: 'File exceeds 16MB limit.' })
  })

  it('rejects video/mp4 on campaign-images with the image-only allow-list', () => {
    expect(
      checkUploadPolicy({ bucket: 'campaign-images', mime: 'video/mp4', size: 1024 })
    ).toEqual({ error: 'Invalid file type: video/mp4. Allowed: JPEG, PNG, WebP.' })
  })

  it('rejects video/mp4 on tenant-assets with the image-only allow-list', () => {
    expect(
      checkUploadPolicy({ bucket: 'tenant-assets', mime: 'video/mp4', size: 1024 })
    ).toEqual({ error: 'Invalid file type: video/mp4. Allowed: JPEG, PNG, WebP.' })
  })

  describe.each(BUCKETS)('unknown mime on bucket=%s', (bucket) => {
    it.each(UNKNOWN_MIMES)('rejects %s', (mime) => {
      const result = checkUploadPolicy({ bucket, mime, size: 1024 })
      const expectedAllowed =
        bucket === 'wa-template-media' ? 'JPEG, PNG, WebP, MP4, 3GP' : 'JPEG, PNG, WebP'
      expect(result).toEqual({ error: `Invalid file type: ${mime}. Allowed: ${expectedAllowed}.` })
    })
  })

  it('caps an image on wa-template-media at 5MB — the video limit does not leak', () => {
    expect(
      checkUploadPolicy({ bucket: 'wa-template-media', mime: 'image/jpeg', size: 5 * 1024 * 1024 + 1 })
    ).toEqual({ error: 'File exceeds 5MB limit.' })
  })
})
