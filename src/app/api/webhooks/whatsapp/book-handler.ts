/**
 * BOOK-001 W2: the chat side of booking.
 *
 * - `handleBookCommand`: exact BOOK / BOOKING / 訂位 / 訂枱 (spec AC-5). Mode
 *   off returns 'off' so the caller runs today's unknown path unchanged.
 * - `maybeReplyToBookingIntent`: the unknown path's classifier hook
 *   (spec AC-4, AC-6). Returns true when it answered (or the wamid was
 *   already answered), false to let today's fallback run.
 *
 * Both send the same reply: a CTA URL button to the personal booking page
 * (simple) or the restaurant's own booking URL (external), in the member's
 * language, as `contact-handler.ts` does.
 */
import { sendCtaUrlButton } from '@/infrastructure/whatsapp/messaging'
import { findMemberByPhone } from '@/infrastructure/supabase/repositories/member-repository'
import { Language } from '@/domain/value-objects/language'
import { inboundBookingDeps } from '@/application/booking/inbound-booking-deps'
import { resolveBookingReplyTarget, type BookingReplyTarget } from '@/application/booking/resolve-booking-reply-target'
import { routeBookingIntent, type BookingLogFn } from '@/application/booking/route-booking-intent'
import type { KapsoMessage } from '@/infrastructure/whatsapp/webhooks'
import { resolveLanguageForMember } from './resolve-language'

const COPY = {
  simple: {
    en: 'Tap below to request a table. The restaurant will confirm your booking.',
    zh: '點擊下方按鈕提交訂位申請,餐廳會再向您確認。',
  },
  external: {
    en: 'Tap below to book a table.',
    zh: '點擊下方按鈕即可訂位。',
  },
  button: { en: 'Book now', zh: '立即訂位' },
} as const

export interface BookContext {
  message: KapsoMessage
  restaurantId: string
  phone: string
  phoneNumberId: string
  log: BookingLogFn
}

async function sendBookingReply(ctx: BookContext, target: BookingReplyTarget) {
  const member = await findMemberByPhone(ctx.restaurantId, ctx.phone)
  const language = await resolveLanguageForMember(member, ctx.restaurantId)
  const lang = language.equals(Language.EN) ? 'en' : 'zh'
  return sendCtaUrlButton(ctx.phoneNumberId, ctx.phone, COPY[target.mode][lang], COPY.button[lang], target.url)
}

/** 'off' → today's unknown path; 'unavailable' → today's fallback reply, no classifier. */
export async function handleBookCommand(ctx: BookContext): Promise<'off' | 'unavailable' | 'sent'> {
  const deps = inboundBookingDeps(ctx.log)
  const config = await deps.getConfig(ctx.restaurantId)
  if (config.mode === 'off') return 'off'
  const target = await resolveBookingReplyTarget(deps, { restaurantId: ctx.restaurantId, phone: ctx.phone, config })
  if (!target) return 'unavailable'
  await sendBookingReply(ctx, target)
  return 'sent'
}

export async function maybeReplyToBookingIntent(ctx: BookContext): Promise<boolean> {
  const decision = await routeBookingIntent(inboundBookingDeps(ctx.log), {
    restaurantId: ctx.restaurantId,
    phone: ctx.phone,
    messageId: ctx.message.messageId,
    messageType: ctx.message.type,
    text: ctx.message.text ?? '',
  })
  if (decision.kind === 'fallback') return false
  if (decision.kind === 'booking_reply') await sendBookingReply(ctx, decision.target)
  return true
}
