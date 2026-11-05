/**
 * Pure client-side helpers for the WhatsApp template VIDEO header uploader
 * (TPL-011). Extracted so they can be unit-tested without a DOM. Mirrors the
 * server-side `wa-template-media` video policy in
 * `/api/dashboard/upload/upload-policy.ts` — server is still the source of
 * truth; these are a UX courtesy that keeps the operator from waiting on an
 * upload the server will reject anyway.
 */

export const VIDEO_ACCEPT = 'video/mp4,video/3gpp'
const VIDEO_TYPES = ['video/mp4', 'video/3gpp'] as const
const MAX_VIDEO_SIZE = 16 * 1024 * 1024 // 16MB, matches the wa-template-media video policy

export interface FileMeta {
  size: number
  type: string
}

/**
 * Client-side pre-check only: the size message mirrors the server's
 * upload-policy module for this bucket, so a rejected pick and a rejected
 * upload read identically to the operator. The mime message lists this
 * uploader's own allow-list (video only) rather than the bucket's full
 * allow-list — the bucket also accepts images, but this uploader never does.
 */
export function videoFileError(file: FileMeta): string | null {
  if (!VIDEO_TYPES.includes(file.type as (typeof VIDEO_TYPES)[number])) {
    return `Invalid file type: ${file.type}. Allowed: MP4, 3GP.`
  }
  if (file.size > MAX_VIDEO_SIZE) {
    return 'File exceeds 16MB limit.'
  }
  return null
}

/**
 * Reads the upload route's response without assuming it is JSON: an nginx
 * 413 (body over `client_max_body_size`) returns an HTML error page, and
 * `res.json()` on that throws an opaque "Unexpected token" at the operator
 * instead of a readable message.
 */
export async function readUploadResponse(res: Response): Promise<{ url: string }> {
  const text = await res.text()
  let data: { url?: string; error?: string } | null = null
  try {
    data = text ? (JSON.parse(text) as { url?: string; error?: string }) : null
  } catch {
    data = null
  }

  if (!data) {
    if (res.status === 413) {
      throw new Error('File is too large for the server to accept. Try a smaller video.')
    }
    throw new Error(`Upload failed (${res.status}). Please try again.`)
  }

  if (!res.ok) throw new Error(data.error ?? 'Upload failed')
  if (!data.url) throw new Error('Upload failed: server returned no file URL')
  return { url: data.url }
}
