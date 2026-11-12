/**
 * BOOK-001: composition root for the booking use cases. Routes and pages take
 * their dependencies from here; tests pass in-memory fakes instead.
 */
import { bookingTokenStore } from '@/infrastructure/supabase/repositories/booking-token-repository'
import { bookingRequestStore } from '@/infrastructure/supabase/repositories/booking-request-repository'
import { bookingSettingsReader } from '@/infrastructure/supabase/repositories/booking-config-repository'
import { findMemberByPhone } from '@/infrastructure/supabase/repositories/member-repository'
import { getRestaurantPhoneNumberId } from '@/infrastructure/supabase/repositories/restaurant-repository'
import { findByIdForRestaurant } from '@/infrastructure/supabase/repositories/whatsapp-template-repository'
import { isWindowOpen } from '@/infrastructure/supabase/repositories/conversation-window-repository'
import { getInboundRateLimiter } from '@/infrastructure/queue/integration-inbound-queue'
import { sendTextMessage } from '@/infrastructure/whatsapp/messaging'
import { sendWhatsAppTemplateMessage } from '@/application/send-template-message'
import { createBookingMessageSender, languageOf } from './send-booking-message'
import type { BookingMemberLookup, BookingMessageSender } from '@/domain/ports/booking'
import type { SubmitBookingDeps } from './submit-booking-request'
import type { DecideBookingDeps } from './decide-booking-request'
import type { ResolveBookingLinkDeps } from './resolve-booking-link'

const now = () => new Date()

const members: BookingMemberLookup = {
  async findMemberId(restaurantId, phone) {
    return (await findMemberByPhone(restaurantId, phone))?.id ?? null
  },
}

export function bookingMessageSender(): BookingMessageSender {
  return createBookingMessageSender({
    getConfig: bookingSettingsReader.getConfig,
    findTemplate: findByIdForRestaurant,
    getPhoneNumberId: getRestaurantPhoneNumberId,
    isWindowOpen: (restaurantId, phoneE164) => isWindowOpen({ restaurantId, phoneE164 }),
    getLanguage: async (restaurantId, phone) => languageOf(await findMemberByPhone(restaurantId, phone)),
    sendTemplate: (args) => sendWhatsAppTemplateMessage(args),
    sendText: sendTextMessage,
  })
}

export function submitBookingDeps(): SubmitBookingDeps {
  return {
    tokens: bookingTokenStore,
    requests: bookingRequestStore,
    settings: bookingSettingsReader,
    members,
    sender: bookingMessageSender(),
    limiter: getInboundRateLimiter(),
    now,
  }
}

export function decideBookingDeps(): DecideBookingDeps {
  return { requests: bookingRequestStore, settings: bookingSettingsReader, sender: bookingMessageSender(), now }
}

export function resolveBookingLinkDeps(): ResolveBookingLinkDeps {
  return { tokens: bookingTokenStore, settings: bookingSettingsReader, now }
}
