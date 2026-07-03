// Shared row→view mapping + unique-violation helper for stamp_campaigns, used by
// both the read repo (list/get) and the write repo (create/status). Mirrors the
// campaign-mapper.ts split so neither repo file exceeds the 150-line limit. The view
// is the serialization shape returned by the owner CRUD routes; the StampCampaign
// entity (domain) carries the status-transition behavior the use cases drive.
import type { StampCampaignStatus } from '@/domain/entities/stamp-campaign'

export interface StampCampaignView {
  id: string
  restaurantId: string
  name: string
  nameZh: string | null
  stampsRequired: number
  rewardId: string
  status: StampCampaignStatus
  maxStampsPerDay: number
  honorUntil: string | null
}

export function mapRowToStampCampaign(
  row: Record<string, unknown>
): StampCampaignView {
  return {
    id: row.id as string,
    restaurantId: row.restaurant_id as string,
    name: row.name as string,
    nameZh: (row.name_zh as string | null) ?? null,
    stampsRequired: Number(row.stamps_required),
    rewardId: row.reward_id as string,
    status: row.status as StampCampaignStatus,
    maxStampsPerDay: Number(row.max_stamps_per_day),
    honorUntil: (row.honor_until as string | null) ?? null,
  }
}

export function extractConstraintName(error: {
  constraint?: string
  message?: string
  details?: string
}): string | null {
  if (error.constraint) return error.constraint
  const haystack = `${error.message ?? ''} ${error.details ?? ''}`
  const match = haystack.match(/"?([a-z0-9_]+)"?/i)
  return match ? match[1] : null
}
