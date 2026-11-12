/**
 * BOOK-001 W2 (spec AC-4, AC-6, AC-7): decide whether an unmatched free-text
 * reply gets the Book now reply instead of today's fallback menu.
 *
 * Runs only for text, only when the tenant has booking on AND passed the
 * eval gate (`aiRoutingEnabled`). The label only selects a reply (R13): the
 * only writes are the classification row and, in simple mode, a chat token.
 * Every classifier failure falls open to the fallback (R12). Logs carry the
 * message id and outcome, never the text or the phone (R8).
 */
import {
  decideBookingIntent,
  isBookingIntentRoutingOn,
  truncateForClassifier,
} from '@/domain/services/booking-intent'
import type { ClassifyResult, IntentClassifierPort } from '@/domain/ports/intent-classifier'
import type { ClassificationOutcome, InboundClassificationStore } from '@/domain/ports/inbound-classification'
import type { BookingConfig } from '@/domain/value-objects/booking-config'
import { resolveBookingReplyTarget, type BookingReplyTarget, type ChatTokenSource } from './resolve-booking-reply-target'

export type BookingLogFn = (level: 'info' | 'warn', event: string, data: Record<string, unknown>) => void

export interface RouteBookingIntentDeps {
  getConfig(restaurantId: string): Promise<BookingConfig>
  classifier: IntentClassifierPort
  classifications: InboundClassificationStore
  tokens: ChatTokenSource
  appUrl: string | undefined
  log: BookingLogFn
}

export interface InboundTextMessage {
  restaurantId: string
  phone: string
  messageId: string
  messageType: string
  text: string
}

export type BookingIntentDecision =
  | { kind: 'booking_reply'; target: BookingReplyTarget }
  | { kind: 'fallback' }
  /** This wamid was classified before (webhook retry): send nothing again. */
  | { kind: 'duplicate' }

const FALLBACK: BookingIntentDecision = { kind: 'fallback' }

export async function routeBookingIntent(
  deps: RouteBookingIntentDeps,
  message: InboundTextMessage
): Promise<BookingIntentDecision> {
  if (message.messageType !== 'text' || message.text.trim() === '') return FALLBACK
  const config = await deps.getConfig(message.restaurantId)
  if (!isBookingIntentRoutingOn(config)) return FALLBACK

  const result = await deps.classifier.classify(truncateForClassifier(message.text))
  if (!result.ok) {
    deps.log('warn', 'booking.classifier_error', { errorClass: result.reason, messageId: message.messageId })
  }
  const target = decideBookingIntent(result) === 'booking_reply' ? await targetFor(deps, message, config) : null
  const outcome: ClassificationOutcome = target ? 'booking_reply' : decideOutcomeWithoutTarget(result)

  const recorded = await deps.classifications.record({
    restaurantId: message.restaurantId,
    messageId: message.messageId,
    label: result.ok ? result.label : null,
    confidence: result.ok ? result.confidence : null,
    outcome,
  })
  if (recorded === 'duplicate') return { kind: 'duplicate' }

  deps.log('info', 'booking.classified', { messageId: message.messageId, outcome, recorded })
  return target ? { kind: 'booking_reply', target } : FALLBACK
}

/** A confident booking whose link could not be built still gets the fallback. */
function decideOutcomeWithoutTarget(result: ClassifyResult): ClassificationOutcome {
  return result.ok ? 'fallback' : 'error'
}

function targetFor(deps: RouteBookingIntentDeps, message: InboundTextMessage, config: BookingConfig) {
  return resolveBookingReplyTarget(
    { tokens: deps.tokens, appUrl: deps.appUrl },
    { restaurantId: message.restaurantId, phone: message.phone, config }
  )
}
