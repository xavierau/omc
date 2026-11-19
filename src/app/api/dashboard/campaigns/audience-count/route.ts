/**
 * CAMP-016: recipient summary for the campaign form. POST (selected member
 * ids travel in the body, never a URL). Tenant from the session only; the
 * response is aggregates only, no member ids or phones (R2). It parses the
 * filters with the same parser campaign create uses and counts with the same
 * SQL predicate the send resolves (count/send parity).
 */
import { NextRequest, NextResponse } from 'next/server'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { assertTagsBelongToTenant } from '@/infrastructure/supabase/repositories/member-tag-repository'
import { getAudienceDefaults } from '@/infrastructure/supabase/repositories/campaign-audience-defaults-repository'
import { countAudience } from '@/infrastructure/supabase/repositories/campaign-audience-repository'
import { audienceQueryForPreview } from '@/application/campaign-audience-query'
import { isValidUUID } from '@/infrastructure/validation/validators'
import { parseTargetAudience, validateTagIds } from '../parse-create-body-audience'
import { parseAudienceSnapshot } from '../parse-audience-filters'
import { CampaignBodyError } from '../parse-create-body-errors'
import { handleError } from '../campaign-error-response'

/** Bounds the request; a larger hand-picked selection is not a real form state. */
const MAX_PREVIEW_MEMBER_IDS = 10000

export async function POST(request: NextRequest) {
  try {
    const { restaurantId } = await getTenantContext()
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body || typeof body !== 'object') throw new CampaignBodyError(400, 'invalid_json')
    const audience = parseTargetAudience(body.targetAudience)
    const tagIds = validateTagIds(body.tagIds, audience)
    if (audience === 'tag') await assertTagsBelongToTenant(tagIds, restaurantId)
    const memberIds = audience === 'selected' ? parseMemberIds(body.memberIds) : []
    const snapshot = parseAudienceSnapshot(body, body.type, await getAudienceDefaults(restaurantId))
    const counts = await countAudience(
      audienceQueryForPreview({
        restaurantId,
        audience,
        tagIds,
        memberIds,
        lapsedDays: snapshot.audienceLapsedDays,
        skip: snapshot.audienceSkipQuality,
      })
    )
    return NextResponse.json({ ...counts, ...snapshot })
  } catch (error) {
    return handleError(error, 'Audience count API error', 'Failed to count recipients')
  }
}

function parseMemberIds(value: unknown): string[] {
  const ok =
    Array.isArray(value) &&
    value.length <= MAX_PREVIEW_MEMBER_IDS &&
    value.every((id) => typeof id === 'string' && isValidUUID(id))
  if (!ok) {
    throw new CampaignBodyError(400, `memberIds must be up to ${MAX_PREVIEW_MEMBER_IDS} member UUIDs`)
  }
  return [...new Set(value as string[])]
}
