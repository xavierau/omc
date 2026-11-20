/**
 * BOOK-001 W2: composition root for inbound booking routing (the BOOK
 * keyword and the classifier on the unknown path). Tests replace it with
 * in-memory fakes (src/test-utils/fake-intent-classifier.ts).
 */
import { getBookingConfig } from '@/infrastructure/supabase/repositories/booking-config-repository'
import {
  findLiveChatToken,
  mintBookingToken,
} from '@/infrastructure/supabase/repositories/booking-token-repository'
import { inboundClassificationStore } from '@/infrastructure/supabase/repositories/inbound-classification-repository'
import { createDecisionsClassifier } from '@/infrastructure/gemini/decisions-client'
import type { ChatTokenSource } from './resolve-booking-reply-target'
import type { BookingLogFn, RouteBookingIntentDeps } from './route-booking-intent'

const chatTokens: ChatTokenSource = {
  findLiveChatToken: (restaurantId, phone) => findLiveChatToken(restaurantId, phone),
  mint: ({ restaurantId, phone, ttlHours }) =>
    mintBookingToken({ restaurantId, phone, source: 'chat', campaignId: null, ttlHours }),
}

export function inboundBookingDeps(log: BookingLogFn): RouteBookingIntentDeps {
  return {
    getConfig: getBookingConfig,
    classifier: createDecisionsClassifier(),
    classifications: inboundClassificationStore,
    tokens: chatTokens,
    appUrl: process.env.NEXT_PUBLIC_APP_URL,
    log,
  }
}
