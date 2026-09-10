import { CampaignBodyError } from './parse-create-body-errors'

/**
 * Validate and normalise a campaign image URL using the WHATWG URL parser.
 *
 * Callers must pass the authenticated restaurantId so cross-tenant URLs
 * can be rejected.
 *
 * Accepted shape:
 *   `https://{SUPABASE_HOST}/storage/v1/object/public/campaign-images/{restaurantId}/...`
 *
 * Rejects (each → 400 CampaignBodyError):
 *  - unparseable URL
 *  - non-https scheme (blocks `javascript:`, `http://`, `file:`…)
 *  - userinfo in the URL (SSRF / credential smuggling)
 *  - URL whose host differs from the configured Supabase host (when set)
 *  - pathname that does not begin with the campaign-images bucket prefix
 *  - tenant segment in pathname that does not equal `restaurantId`
 */
const CAMPAIGN_IMAGE_PATH_RE =
  /^\/storage\/v1\/object\/public\/campaign-images\/([^/]+)\//

// Compute once at module load. If the env var is unset (e.g. unit tests that
// don't boot Supabase), host comparison is skipped — the other guards still
// prevent SSRF.
const SUPABASE_HOST: string | null = (() => {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!raw) return null
  try {
    return new URL(raw).host
  } catch {
    return null
  }
})()

export function parseImageUrl(v: unknown, restaurantId: string): string | null {
  if (typeof v !== 'string') return null
  const trimmed = v.trim()
  if (trimmed === '') return null

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new CampaignBodyError(400, 'image URL must be a valid URL')
  }

  if (url.protocol !== 'https:') {
    throw new CampaignBodyError(400, 'image URL must use https')
  }
  if (url.username || url.password) {
    throw new CampaignBodyError(400, 'image URL must not contain userinfo')
  }
  if (SUPABASE_HOST && url.host !== SUPABASE_HOST) {
    throw new CampaignBodyError(400, 'image URL has unexpected host')
  }

  const match = url.pathname.match(CAMPAIGN_IMAGE_PATH_RE)
  if (!match) {
    throw new CampaignBodyError(
      400,
      'image URL must point at /storage/v1/object/public/campaign-images/'
    )
  }
  if (match[1] !== restaurantId) {
    throw new CampaignBodyError(
      400,
      'image URL tenant prefix does not match the authenticated tenant'
    )
  }

  return trimmed
}
