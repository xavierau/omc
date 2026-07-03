import { CampaignBodyError } from './parse-create-body-errors'

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

export function validateTagIds(
  value: unknown,
  targetAudience: TargetAudience
): string[] {
  if (targetAudience !== 'tag') return []
  const ok =
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((id) => typeof id === 'string' && id.trim().length > 0)
  if (!ok) {
    throw new CampaignBodyError(
      400,
      'tagIds must be a non-empty array of non-empty strings when targeting a tag'
    )
  }
  return value as string[]
}
