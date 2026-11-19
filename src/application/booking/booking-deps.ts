/**
 * BOOK-001: composition root for the booking use cases. Routes and pages take
 * their dependencies from here; tests pass in-memory fakes instead.
 */
import { bookingTokenStore } from '@/infrastructure/supabase/repositories/booking-token-repository'
import { bookingCronStore, bookingRequestStore } from '@/infrastructure/supabase/repositories/booking-request-repository'
import { bookingSettingsReader, promoteBookingTemplateCandidate } from '@/infrastructure/supabase/repositories/booking-config-repository'
import { findMemberByPhone } from '@/infrastructure/supabase/repositories/member-repository'
import { getRestaurantPhoneNumberId } from '@/infrastructure/supabase/repositories/restaurant-repository'
import { findManyByIdsForRestaurant } from '@/infrastructure/supabase/repositories/whatsapp-template-repository'
import { isWindowOpen } from '@/infrastructure/supabase/repositories/conversation-window-repository'
import { getInboundRateLimiter } from '@/infrastructure/queue/integration-inbound-queue'
import { sendTextMessage } from '@/infrastructure/whatsapp/messaging'
import { sendWhatsAppTemplateMessage } from '@/application/send-template-message'
import { changeBookingConfig, getBookingConfig } from '@/infrastructure/supabase/repositories/booking-config-repository'
import {
  agentBookingDirectory,
  agentBookingStore,
  unverifiedBookingPurgeStore,
} from '@/infrastructure/supabase/repositories/agent-booking-repository'
import { agentBookingSecrets } from './agent-booking-secrets'
import { createBookingMessageSender, languageOf } from './send-booking-message'
import type { BookingMemberLookup, BookingMessageSender } from '@/domain/ports/booking'
import type { SubmitBookingDeps } from './submit-booking-request'
import type { DecideBookingDeps } from './decide-booking-request'
import type { ResolveBookingLinkDeps } from './resolve-booking-link'
import type { SendBookingRemindersDeps } from './send-booking-reminders'
import type { PurgeBookingPiiDeps } from './purge-booking-pii'
import type { CreateAgentBookingDeps } from './create-agent-booking'
import type { GetAgentBookingStatusDeps } from './get-agent-booking-status'
import type { VerifyAgentBookingDeps } from './verify-agent-booking'
import type { AgentBookingSettingsDeps, AgentOpenApiDeps } from './agent-booking-settings'

const now = () => new Date()

/** BOOK-003 (R44): the privacy link in the collection statement, as BOOK-001 R18's page. */
export const PRIVACY_URL = process.env.NEXT_PUBLIC_PRIVACY_URL || 'https://ohmyclient.io/privacy-policy.html'
const appUrl = () => process.env.NEXT_PUBLIC_APP_URL ?? ''

const members: BookingMemberLookup = {
  async findMemberId(restaurantId, phone) {
    return (await findMemberByPhone(restaurantId, phone))?.id ?? null
  },
}

export function bookingMessageSender(): BookingMessageSender {
  return createBookingMessageSender({
    getConfig: bookingSettingsReader.getConfig,
    findTemplates: findManyByIdsForRestaurant,
    promoteCandidate: promoteBookingTemplateCandidate,
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

/** W3 (AC-15): the reminder cron. */
export function bookingReminderDeps(): SendBookingRemindersDeps {
  return { store: bookingCronStore, sender: bookingMessageSender(), settings: bookingSettingsReader, now }
}

/** W3 (R19): the retention cron. */
export function bookingRetentionDeps(): PurgeBookingPiiDeps {
  return { store: bookingCronStore, unverified: unverifiedBookingPurgeStore, now }
}

/** BOOK-003: the public agent API (create). */
export function createAgentBookingDeps(): CreateAgentBookingDeps {
  return {
    directory: agentBookingDirectory,
    store: agentBookingStore,
    settings: bookingSettingsReader,
    limiter: getInboundRateLimiter(),
    secrets: agentBookingSecrets,
    privacyUrl: PRIVACY_URL,
    now,
  }
}

/** BOOK-003: the public agent API (status read). */
export function getAgentBookingStatusDeps(): GetAgentBookingStatusDeps {
  return { directory: agentBookingDirectory, store: agentBookingStore, now }
}

/** BOOK-003: the OpenAPI description an agent reads. */
export function agentOpenApiDeps(): AgentOpenApiDeps & { directory: typeof agentBookingDirectory } {
  return { directory: agentBookingDirectory, settings: bookingSettingsReader, appUrl: appUrl(), privacyUrl: PRIVACY_URL }
}

/** BOOK-003: the webhook's confirm-code check. */
export function verifyAgentBookingDeps(): VerifyAgentBookingDeps {
  return {
    store: agentBookingStore,
    settings: bookingSettingsReader,
    sender: bookingMessageSender(),
    async sendText(restaurantId, phone, text) {
      try {
        const phoneNumberId = await getRestaurantPhoneNumberId(restaurantId)
        if (phoneNumberId) await sendTextMessage(phoneNumberId, phone, text)
      } catch (err) {
        console.warn('[AgentBooking] collection statement not sent:', (err as Error).name)
      }
    },
    privacyUrl: PRIVACY_URL,
    now,
  }
}

/** BOOK-003: admin settings for agent booking. */
export function agentBookingSettingsDeps(): AgentBookingSettingsDeps {
  return {
    getConfig: getBookingConfig,
    changeConfig: changeBookingConfig,
    settings: bookingSettingsReader,
    secrets: agentBookingSecrets,
    appUrl: appUrl(),
  }
}
