/**
 * BOOK-001 W2: pure rules for routing a free-text reply to booking.
 *
 * Only a confident `booking` label changes the reply; every other result,
 * including any failure, keeps today's fallback (spec AC-4, AC-6; R12).
 */
import type { ClassifyResult } from '@/domain/ports/intent-classifier'
import type { ClassificationOutcome } from '@/domain/ports/inbound-classification'
import type { BookingConfig } from '@/domain/value-objects/booking-config'

/** Google's examples start at 0.7; the eval (spec OQ4) sets the real value. */
export const BOOKING_CONFIDENCE_THRESHOLD = 0.7

/** Cost and disclosure cap on what is sent to the classifier (R12). */
export const CLASSIFIER_INPUT_MAX_CHARS = 1000

/** Trims, then cuts to the cap without leaving half a surrogate pair. */
export function truncateForClassifier(text: string): string {
  const trimmed = text.trim()
  if (trimmed.length <= CLASSIFIER_INPUT_MAX_CHARS) return trimmed
  const cut = trimmed.slice(0, CLASSIFIER_INPUT_MAX_CHARS)
  const last = cut.charCodeAt(cut.length - 1)
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut
}

export function decideBookingIntent(result: ClassifyResult): ClassificationOutcome {
  if (!result.ok) return 'error'
  const confident = result.confidence >= BOOKING_CONFIDENCE_THRESHOLD
  return result.label === 'booking' && confident ? 'booking_reply' : 'fallback'
}

/** The classifier runs only when the tenant has booking on AND passed the eval gate. */
export function isBookingIntentRoutingOn(config: BookingConfig): boolean {
  return config.mode !== 'off' && config.aiRoutingEnabled
}

/** `${appUrl}/b/<token>`, or null when the app URL is not configured. */
export function buildBookingLinkUrl(appUrl: string | undefined, token: string): string | null {
  if (!appUrl) return null
  return `${appUrl.replace(/\/+$/, '')}/b/${encodeURIComponent(token)}`
}
