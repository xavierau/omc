/**
 * BOOK-001: composition root for the booking use cases. Routes and pages take
 * their dependencies from here; tests pass in-memory fakes instead.
 */
import { bookingTokenStore, findLiveChatToken, mintBookingToken } from '@/infrastructure/supabase/repositories/booking-token-repository'
import { bookingRoomStore, bookingStopStore, findStaffDisplayName } from '@/infrastructure/supabase/repositories/booking-room-repository'
import {
  bookingCronStore,
  bookingNoShowStore,
  bookingRequestStore,
} from '@/infrastructure/supabase/repositories/booking-request-repository'
import { bookingSettingsReader, promoteBookingTemplateCandidate } from '@/infrastructure/supabase/repositories/booking-config-repository'
import { findMemberByPhone, findMemberIdByPhoneStrict } from '@/infrastructure/supabase/repositories/member-repository'
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
import { resolveAgentAppUrl } from './agent-booking-settings'
import { resolveBookingReplyTarget } from './resolve-booking-reply-target'
import { createBookingMessageSender, languageOf } from './send-booking-message'
import type { BookingMemberLookup, BookingMessageSender } from '@/domain/ports/booking'
import type { SubmitBookingDeps } from './submit-booking-request'
import type { DecideBookingDeps } from './decide-booking-request'
import type { BookingNoShowDeps } from './booking-no-show'
import type { ResolveBookingLinkDeps } from './resolve-booking-link'
import type { SendBookingRemindersDeps } from './send-booking-reminders'
import type { PurgeBookingPiiDeps } from './purge-booking-pii'
import type { PurgeUnverifiedBookingsDeps } from './purge-unverified-bookings'
import type { CreateAgentBookingDeps } from './create-agent-booking'
import type { GetAgentBookingStatusDeps } from './get-agent-booking-status'
import type { GetAgentAvailabilityDeps } from './get-agent-availability'
import type { VerifyAgentBookingDeps } from './verify-agent-booking'
import type { AgentBookingSettingsDeps, AgentOpenApiDeps } from './agent-booking-settings'
import type { BookingCapacityDeps } from './booking-capacity'
import type { AgentBookingRoomDeps } from './agent-booking-full-reply'
import { recordDecisionMessage } from '@/infrastructure/supabase/repositories/booking-request-repository'
import { checkinStore, staffBookingStore } from '@/infrastructure/supabase/repositories/staff-booking-repository'
import { parseE164Phone } from '@/infrastructure/phone/e164-parser'
import { isPhoneNormalizeError } from '@/domain/ports/phone-normalizer'
import type { StaffBookingDeps } from './staff-booking-shared'
import type { BookingCheckInDeps } from './booking-check-in'
import { depositChannelPorts, depositDecisionDeps, startDepositDeps } from '@/application/payments/payment-deps'
import { bookingDepositStore } from '@/infrastructure/supabase/repositories/booking-deposit-repository'
import { agentDepositPromoter } from '@/infrastructure/supabase/repositories/agent-booking-repository'
import { productionPaymentRegistry } from '@/infrastructure/payments/registry'

const now = () => new Date()

/** BOOK-003 (R44): the privacy link in the collection statement, as BOOK-001 R18's page. */
export const PRIVACY_URL = process.env.NEXT_PUBLIC_PRIVACY_URL || 'https://ohmyclient.io/privacy-policy.html'
/** Review F6: null unless https (http://localhost outside production); the agent routes then answer 500. */
const appUrl = () => resolveAgentAppUrl(process.env.NEXT_PUBLIC_APP_URL, process.env.NODE_ENV)

export const members: BookingMemberLookup = {
  async findMemberId(restaurantId, phone) {
    return (await findMemberByPhone(restaurantId, phone))?.id ?? null
  },
}

/** BOOK-008 r1 F7: the poppy-promotion link's lookup throws on a DB error, so linkExistingMember logs it. */
const membersOrThrow: BookingMemberLookup = {
  async findMemberId(restaurantId, phone) {
    return findMemberIdByPhoneStrict(restaurantId, phone)
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
    // BOOK-014 W4: the deposit request's one button (`<app>/p/{{1}}`) is a dynamic URL button other
    // than Book now, which sendWhatsAppTemplateMessage fills from its coupon-code slot; the /p token goes there.
    sendTemplate: ({ linkToken, ...args }) => sendWhatsAppTemplateMessage(linkToken ? { ...args, couponCode: linkToken } : args),
    sendText: sendTextMessage,
  })
}

/** BOOK-013 (R7): the repo's one E.164 normaliser (HK default region). */
const normalizePhone = (raw: string): string | null => {
  const parsed = parseE164Phone(raw)
  return isPhoneNormalizeError(parsed) ? null : parsed.value
}

/** BOOK-013 S1–S3: staff create / edit / cancel. */
export function staffBookingDeps(): StaffBookingDeps {
  return {
    store: staffBookingStore,
    settings: bookingSettingsReader,
    room: bookingRoomStore,
    members,
    sender: bookingMessageSender(),
    normalizePhone,
    recordMessage: recordDecisionMessage,
    now,
    // BOOK-014 W4 (spec AC-11): staff create with a deposit.
    deposit: { accounts: depositChannelPorts.accounts, start: startDepositDeps() },
  }
}

/** BOOK-013 S7: the Today view, Arrived / Undo. */
export function bookingCheckInDeps(): BookingCheckInDeps {
  return { store: checkinStore, settings: bookingSettingsReader, now }
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
    // BOOK-010: guest limits and stops (atomic insert, migration 092).
    room: bookingRoomStore,
    // BOOK-014 W3: the deposit hold + hosted payment when the restaurant's rule applies.
    deposit: { ...depositChannelPorts, start: startDepositDeps() },
  }
}

export function decideBookingDeps(): DecideBookingDeps {
  return {
    requests: bookingRequestStore, settings: bookingSettingsReader, sender: bookingMessageSender(), now,
    // BOOK-010 (spec AC-10): ask before a confirm goes over a guest limit.
    overLimit: { getConfig: bookingSettingsReader.getConfig, room: bookingRoomStore },
    // BOOK-014 W4 (spec AC-12): decline refunds a paid deposit.
    deposits: depositDecisionDeps(),
  }
}

/** BOOK-010 (spec S3): staff capacity block, month badges, stop / resume. */
export function bookingCapacityDeps(): BookingCapacityDeps {
  return { getConfig: bookingSettingsReader.getConfig, room: bookingRoomStore, stops: bookingStopStore, staffName: findStaffDisplayName, now }
}

/** BOOK-010 (spec AC-6): the PAP code step's room check and the full reply's booking link (the diner's chat link). */
/** The diner's booking link in a code-step reply (BOOK-009 F1 refusal, BOOK-010 full), as the BOOK keyword reply builds it. */
const chatBookingLink: AgentBookingRoomDeps['bookingLink'] = async (restaurantId, phone, config) => {
  const tokens = {
    findLiveChatToken,
    mint: ({ restaurantId: r, phone: p, ttlHours }: { restaurantId: string; phone: string; ttlHours: number | null }) =>
      mintBookingToken({ restaurantId: r, phone: p, source: 'chat', campaignId: null, ttlHours }),
  }
  const target = await resolveBookingReplyTarget({ tokens, appUrl: appUrl() ?? undefined }, { restaurantId, phone, config })
  return target?.url ?? null
}

const agentBookingRoom: AgentBookingRoomDeps = { reader: bookingRoomStore, bookingLink: chatBookingLink }

/** BOOK-007 (R5): mark / undo a no-show. No message sender: the diner is never told. */
export function noShowBookingDeps(): BookingNoShowDeps {
  return { store: bookingNoShowStore, now }
}

export function resolveBookingLinkDeps(): ResolveBookingLinkDeps {
  // BOOK-010 (spec AC-12): the page's 已滿 states come from the guest counts and stops.
  return { tokens: bookingTokenStore, settings: bookingSettingsReader, now, room: bookingRoomStore }
}

/** W3 (AC-15): the reminder cron. */
export function bookingReminderDeps(): SendBookingRemindersDeps {
  return { store: bookingCronStore, sender: bookingMessageSender(), settings: bookingSettingsReader, now }
}

/** W3 (R19): the retention cron. */
export function bookingRetentionDeps(): PurgeBookingPiiDeps {
  return { store: bookingCronStore, now }
}

/** BOOK-003 (R41, review F3): the unverified purge step of the 5-minute reminders cron. */
export function unverifiedBookingPurgeDeps(): PurgeUnverifiedBookingsDeps {
  return { store: unverifiedBookingPurgeStore, now }
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
    room: bookingRoomStore,
  }
}

/** BOOK-003: the public agent API (status read). */
export function getAgentBookingStatusDeps(): GetAgentBookingStatusDeps {
  // BOOK-014 W5 (spec AC-10): awaiting_deposit carries the deposit and the stored hosted payment URL.
  return { directory: agentBookingDirectory, store: agentBookingStore, now, deposits: { store: bookingDepositStore, registry: productionPaymentRegistry() } }
}

/** BOOK-003: the OpenAPI description an agent reads. */
export function agentOpenApiDeps(): AgentOpenApiDeps & { directory: typeof agentBookingDirectory } {
  return {
    directory: agentBookingDirectory, settings: bookingSettingsReader, appUrl: appUrl(), privacyUrl: PRIVACY_URL, now,
    // BOOK-014 W5: the deposit and its rule while the restaurant takes deposits.
    accounts: depositChannelPorts.accounts,
  }
}

/** BOOK-009 W4: the public agent API (availability); same limiter, its own key and limit (BOOK-010-RL). */
export function getAgentAvailabilityDeps(): GetAgentAvailabilityDeps {
  return { directory: agentBookingDirectory, limiter: getInboundRateLimiter(), now, room: bookingRoomStore }
}

/** BOOK-003: the webhook's confirm-code check. */
export function verifyAgentBookingDeps(): VerifyAgentBookingDeps {
  return {
    store: agentBookingStore,
    members: membersOrThrow,
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
    // BOOK-009 F1 (P2-2): the refusal reply's booking link, as the BOOK keyword reply builds it.
    bookingLink: chatBookingLink,
    privacyUrl: PRIVACY_URL,
    now,
    room: agentBookingRoom,
    // BOOK-014 W5 (spec AC-10): a code for a booking that needs a deposit holds it and sends the link.
    deposit: { accounts: depositChannelPorts.accounts, start: startDepositDeps(), promoter: agentDepositPromoter },
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
    // BOOK-014 W5: poppy.json states the deposit while the restaurant takes deposits.
    accounts: depositChannelPorts.accounts,
  }
}
