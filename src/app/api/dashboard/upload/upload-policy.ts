/**
 * Per-bucket upload policy for `POST /api/dashboard/upload`.
 *
 * Images are accepted on every bucket at 5MB. Video is accepted only on
 * `wa-template-media` (WhatsApp template headers), at 16MB — Meta's own
 * VIDEO header limit. A file at exactly the limit is accepted; the limit is
 * exceeded only past it.
 */

const VIDEO_BUCKET = 'wa-template-media'

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const IMAGE_MAX_SIZE = 5 * 1024 * 1024

const VIDEO_TYPES = ['video/mp4', 'video/3gpp']
const VIDEO_MAX_SIZE = 16 * 1024 * 1024

export interface UploadPolicyInput {
  bucket: string
  mime: string
  size: number
}

export interface UploadPolicyViolation {
  error: string
}

export function checkUploadPolicy(input: UploadPolicyInput): UploadPolicyViolation | null {
  const { bucket, mime, size } = input

  if (IMAGE_TYPES.includes(mime)) {
    return size > IMAGE_MAX_SIZE ? { error: 'File exceeds 5MB limit.' } : null
  }

  if (bucket === VIDEO_BUCKET && VIDEO_TYPES.includes(mime)) {
    return size > VIDEO_MAX_SIZE ? { error: 'File exceeds 16MB limit.' } : null
  }

  const allowed = bucket === VIDEO_BUCKET ? 'JPEG, PNG, WebP, MP4, 3GP' : 'JPEG, PNG, WebP'
  return { error: `Invalid file type: ${mime}. Allowed: ${allowed}.` }
}
