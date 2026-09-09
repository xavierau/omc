import { describe, it, expect } from 'vitest'
import { videoFileError, readUploadResponse, VIDEO_ACCEPT } from '../video-uploader-helpers'

const MAX_VIDEO_SIZE = 16 * 1024 * 1024

describe('videoFileError', () => {
  it('rejects a file over the 16MB limit', () => {
    expect(videoFileError({ size: MAX_VIDEO_SIZE + 1, type: 'video/mp4' })).toBe(
      'File exceeds 16MB limit.'
    )
  })

  it('accepts a file at exactly the 16MB limit', () => {
    expect(videoFileError({ size: MAX_VIDEO_SIZE, type: 'video/mp4' })).toBeNull()
  })

  it('rejects a mime outside video/mp4 and video/3gpp, mirroring the server message for this bucket', () => {
    expect(videoFileError({ size: 1000, type: 'video/quicktime' })).toBe(
      'Invalid file type: video/quicktime. Allowed: JPEG, PNG, WebP, MP4, 3GP.'
    )
  })

  it('accepts video/mp4 and video/3gpp', () => {
    expect(videoFileError({ size: 1000, type: 'video/mp4' })).toBeNull()
    expect(videoFileError({ size: 1000, type: 'video/3gpp' })).toBeNull()
  })
})

describe('readUploadResponse', () => {
  function jsonResponse(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  it('returns {url} for a 200 JSON response', async () => {
    const res = jsonResponse(200, { url: 'https://cdn.test/v.mp4' })

    await expect(readUploadResponse(res)).resolves.toEqual({ url: 'https://cdn.test/v.mp4' })
  })

  it('throws the server error message for a 400 JSON response', async () => {
    const res = jsonResponse(400, { error: 'File exceeds 16MB limit.' })

    await expect(readUploadResponse(res)).rejects.toThrow('File exceeds 16MB limit.')
  })

  it('throws a readable message for a 413 HTML body instead of a JSON parse error', async () => {
    const res = new Response('<html><body>413 Request Entity Too Large</body></html>', {
      status: 413,
      headers: { 'Content-Type': 'text/html' },
    })

    await expect(readUploadResponse(res)).rejects.toThrow('File is too large for the server')
  })
})

describe('VIDEO_ACCEPT', () => {
  it('lists mp4 and 3gpp', () => {
    expect(VIDEO_ACCEPT).toBe('video/mp4,video/3gpp')
  })
})
