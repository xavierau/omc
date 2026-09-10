/**
 * Pure client-side helpers for the welcome-campaign image uploader (ONBOARD-010).
 * Extracted so they can be unit-tested without a DOM. Mirrors the
 * server-side validation in `/api/dashboard/upload` — server is still the
 * source of truth; these are a UX courtesy.
 */

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB, matches upload route

export type Lang = 'en' | 'zhHk'

export type FileValidationError =
  | { kind: 'tooLarge' }
  | { kind: 'wrongType' }

export interface FileMeta {
  size: number
  type: string
}

export function validateImageFile(file: FileMeta): FileValidationError | null {
  if (!ALLOWED_TYPES.includes(file.type as (typeof ALLOWED_TYPES)[number])) {
    return { kind: 'wrongType' }
  }
  if (file.size > MAX_FILE_SIZE) {
    return { kind: 'tooLarge' }
  }
  return null
}

/**
 * Build the tenant-scoped storage path for a welcome-campaign image.
 * Shape: `{restaurantId}/{campaignId}/{lang}.{ext}`. When `campaignId` is
 * absent (create-new flow) the path uses a per-form-session draft nonce —
 * `{restaurantId}/draft-{nonce}/{lang}.{ext}` — so concurrent admins don't
 * overwrite each other's blobs at the shared `draft/` prefix.
 * The server enforces that the first path segment matches the
 * authenticated restaurantId.
 */
export function buildCampaignImagePath(input: {
  restaurantId: string
  campaignId: string | null
  draftNonce?: string
  lang: Lang
  mime: string
}): string {
  const ext = extFromMime(input.mime)
  if (input.campaignId && input.campaignId !== '') {
    return `${input.restaurantId}/${input.campaignId}/${input.lang}.${ext}`
  }
  const draft = input.draftNonce ? `draft-${input.draftNonce}` : 'draft'
  return `${input.restaurantId}/${draft}/${input.lang}.${ext}`
}

function extFromMime(mime: string): string {
  if (mime === 'image/jpeg') return 'jpg'
  if (mime === 'image/png') return 'png'
  if (mime === 'image/webp') return 'webp'
  // Safe default: unknown mime shouldn't leak a .bin blob into the bucket.
  return 'png'
}
