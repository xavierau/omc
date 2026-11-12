/**
 * BOOK-001: the booking message sender (W1; W3 adds per-language templates
 * and the reminder cron caller).
 *
 * Ladder: the restaurant's APPROVED booking template for this kind ->
 * free-form text while the diner's 24-hour window is open -> not delivered.
 * Never throws: the booking state is already saved when this runs, and the
 * caller reports `delivered: false` to staff instead (spec AC-14 warning
 * state). Logs carry the kind and a masked phone only (R8).
 */
import { isTemplateSendable, type WhatsAppTemplate } from '@/domain/entities/whatsapp-template'
import { bookingParamsForBody, buildBookingText } from '@/domain/services/booking-message'
import { Language, type LanguageCode } from '@/domain/value-objects/language'
import type { BookingConfig } from '@/domain/value-objects/booking-config'
import type { BookingMessageInput, BookingMessageSender, BookingSendResult } from '@/domain/ports/booking'
import type { SendResult } from '@/domain/value-objects/send-result'

export interface BookingSenderDeps {
  getConfig(restaurantId: string): Promise<BookingConfig>
  findTemplate(id: string, restaurantId: string): Promise<WhatsAppTemplate | null>
  getPhoneNumberId(restaurantId: string): Promise<string>
  isWindowOpen(restaurantId: string, phone: string): Promise<boolean>
  getLanguage(restaurantId: string, phone: string): Promise<LanguageCode>
  sendTemplate(args: { phoneNumberId: string; to: string; template: WhatsAppTemplate; paramValues: Record<string, string> }): Promise<SendResult>
  sendText(phoneNumberId: string, to: string, text: string): Promise<SendResult>
}

const maskPhone = (phone: string) => `***${phone.slice(-4)}`

function failed(input: BookingMessageInput, reason: string): BookingSendResult {
  console.warn('[Booking] message not delivered:', { kind: input.kind, to: maskPhone(input.phone), reason })
  return { delivered: false, reason: 'send_failed' }
}

// W3: one template per language; the diner's own language first, then the
// other one (a diner who reads English still gets the Chinese confirmation
// rather than nothing outside the 24-hour window).
async function approvedTemplate(deps: BookingSenderDeps, input: BookingMessageInput, language: LanguageCode) {
  const config = await deps.getConfig(input.restaurantId)
  const byLanguage = config.templateIds[input.kind]
  const order = [language, Language.of(language).other().code]
  for (const id of order.map((lang) => byLanguage[lang])) {
    if (!id) continue
    const template = await deps.findTemplate(id, input.restaurantId)
    if (template && isTemplateSendable(template)) return template
  }
  return null
}

async function sendOnce(deps: BookingSenderDeps, input: BookingMessageInput): Promise<BookingSendResult> {
  const phoneNumberId = await deps.getPhoneNumberId(input.restaurantId)
  if (!phoneNumberId) return { delivered: false, reason: 'no_sender' }

  const language = await deps.getLanguage(input.restaurantId, input.phone)
  const template = await approvedTemplate(deps, input, language)
  if (template) {
    // F3: this row's own BODY params, never a fixed set per kind.
    const body = template.components.find((c) => c.type === 'BODY')?.text ?? ''
    const paramValues = bookingParamsForBody(body, input.details)
    if (!paramValues) return failed(input, 'template_params_unknown')
    const result = await deps.sendTemplate({ phoneNumberId, to: input.phone, template, paramValues })
    return result.ok ? { delivered: true, via: 'template' } : failed(input, result.error?.title ?? 'template_send_failed')
  }

  if (!(await deps.isWindowOpen(input.restaurantId, input.phone))) return { delivered: false, reason: 'outside_window' }
  const result = await deps.sendText(phoneNumberId, input.phone, buildBookingText(input.kind, language, input.details))
  return result.ok ? { delivered: true, via: 'text' } : failed(input, result.error?.title ?? 'text_send_failed')
}

export function createBookingMessageSender(deps: BookingSenderDeps): BookingMessageSender {
  return {
    async send(input) {
      try {
        return await sendOnce(deps, input)
      } catch (err) {
        console.warn('[Booking] message send threw:', { kind: input.kind, to: maskPhone(input.phone), error: (err as Error).name })
        return { delivered: false, reason: 'error' }
      }
    },
  }
}

/** Member's own language when the phone is a member, else the default (zh-HK). */
export function languageOf(member: { preferredLanguage: string | null } | null): LanguageCode {
  return Language.fromCodeOrDefault(member?.preferredLanguage ?? null, Language.default()).code
}
