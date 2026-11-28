import type { TemplateStatus } from '@/domain/entities/whatsapp-template'

/**
 * Single source of truth for Meta -> local template-status mapping.
 * Consumed by BOTH the cron sync (application/sync-template-status.ts)
 * and the webhook handler (T5) so the two paths can never drift.
 *
 * Meta sends uppercase event/status strings; deliberately NOT
 * lowercase-normalised — mirrors the pre-extraction cron behavior exactly.
 */
const META_STATUS_MAP: Record<string, TemplateStatus> = {
  APPROVED: 'approved',
  REJECTED: 'rejected',
  PENDING: 'pending',
  PAUSED: 'paused',
  DISABLED: 'disabled',
}

/** Local statuses eligible to be overwritten by a Meta-sourced update. */
export const SYNCABLE_STATUSES: readonly TemplateStatus[] = [
  'pending',
  'approved',
  'paused',
] as const

export const NO_REJECTION_REASON = 'Rejected by Meta (no reason provided)'

/** Maps a raw Meta status/event string to a local TemplateStatus, or null if unrecognised. */
export function mapMetaTemplateStatus(metaStatus: string): TemplateStatus | null {
  return META_STATUS_MAP[metaStatus] ?? null
}
