import { CampaignBodyError } from './parse-create-body-errors'
import { isValidUUID } from '@/infrastructure/validation/validators'

/**
 * Target-audience parsing + selection validation for campaign create.
 * Extracted from `parse-create-body.ts` to keep that file under the 150-line
 * cap once tag targeting was added. Co-locates all audience-selection rules.
 */
export type TargetAudience = 'all' | 'selected' | 'tag'

export function parseTargetAudience(value: unknown): TargetAudience {
  if (value === 'selected') return 'selected'
  if (value === 'tag') return 'tag'
  return 'all'
}

export function validateMemberIds(
  value: unknown,
  targetAudience: TargetAudience
): string[] {
  if (targetAudience !== 'selected') return []
  const ok =
    Array.isArray(value) && value.length > 0 && value.every((id) => typeof id === 'string')
  if (!ok) {
    throw new CampaignBodyError(
      400,
      'memberIds must be a non-empty array of strings when targeting selected members'
    )
  }
  return value as string[]
}

/**
 * Ceiling on how many tags one campaign may target. The live recipient-count
 * route enforces the SAME ceiling, so every selection this accepts can also be
 * counted — a lower cap there turned a valid selection into a count error
 * (review round 2, finding 4).
 */
export const MAX_TAG_IDS = 50

const TAG_IDS_MESSAGE =
  'tagIds must be a non-empty array of tag UUIDs when targeting a tag'

/**
 * Validates shape AND identity: a non-UUID id reaches PostgREST as
 * `invalid input syntax for type uuid`, which the route's catch-all reports as
 * a 500 for what is really bad client input.
 */
export function validateTagIds(
  value: unknown,
  targetAudience: TargetAudience
): string[] {
  if (targetAudience !== 'tag') return []
  const ok =
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((id) => typeof id === 'string' && isValidUUID(id))
  if (!ok) throw new CampaignBodyError(400, TAG_IDS_MESSAGE)
  const uniqueIds = [...new Set(value as string[])]
  if (uniqueIds.length > MAX_TAG_IDS) {
    throw new CampaignBodyError(
      400,
      `tagIds must target at most ${MAX_TAG_IDS} tags`
    )
  }
  return uniqueIds
}
