import {
  QualityStateEvent,
  type QualityStateEventProps,
} from '@/domain/entities/quality-state-event'
import type { QualityRating } from '@/domain/value-objects/quality-rating'

export interface TenantQualityStateRow {
  id: string
  restaurant_id: string
  phone_number_id: string
  quality_rating: QualityRating
  messaging_tier: string | null
  flagged: boolean
  raw_payload: Record<string, unknown> | null
  transitioned_at: string
}

export interface TenantQualityStateInsertRow {
  id: string
  restaurant_id: string
  phone_number_id: string
  quality_rating: QualityRating
  messaging_tier: string | null
  flagged: boolean
  raw_payload: Record<string, unknown> | null
  transitioned_at: string
}

export function toEntity(row: TenantQualityStateRow): QualityStateEvent {
  const props: QualityStateEventProps = {
    id: row.id,
    restaurantId: row.restaurant_id,
    phoneNumberId: row.phone_number_id,
    qualityRating: row.quality_rating,
    messagingTier: row.messaging_tier,
    flagged: row.flagged,
    rawPayload: row.raw_payload,
    transitionedAt: row.transitioned_at,
  }
  return QualityStateEvent.fromProps(props)
}

export function toInsertRow(
  e: QualityStateEvent
): TenantQualityStateInsertRow {
  const s = e.snapshot
  return {
    id: s.id,
    restaurant_id: s.restaurantId,
    phone_number_id: s.phoneNumberId,
    quality_rating: s.qualityRating,
    messaging_tier: s.messagingTier,
    flagged: s.flagged,
    raw_payload: s.rawPayload,
    transitioned_at: s.transitionedAt,
  }
}
