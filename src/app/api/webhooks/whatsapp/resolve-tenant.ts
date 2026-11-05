// WAQ-006 / TPL-009: tenant resolution for incoming WhatsApp webhooks.
// Three identifier paths are supported because Meta's webhook surface is
// inconsistent:
//   - `phone_number_id` (numeric)        -> messages, statuses, account_update
//   - `display_phone_number` (E.164-ish) -> phone_number_quality_update
//   - WABA id (`entry[].id`)             -> message_template_status_update
// Without the display-number fallback, `phone_number_quality_update`
// events are silently dropped because there is no phone_number_id to
// look up. `message_template_status_update` carries NEITHER phone
// identifier, so it needs its own (third, last) rung keyed on the WABA id.
// That rung is safe to place last because `extractTemplateStatusWabaId` is
// shape-gated — it returns non-null ONLY for template-status-shaped
// payloads, so it can never misroute existing phone/display traffic.
//
// The display-phone rung below does NOT early-return on a miss (unlike the
// phone-number rung, which also falls through): a miss there must still
// fall through to the WABA rung rather than shadow it, in case a payload
// ever carried both a (stray) display_phone_number-shaped field and a WABA
// id. In practice today's payload shapes don't overlap, but the fall-through
// costs nothing and removes the shadow risk structurally.

import {
  findByBusinessAccountId,
  findByDisplayPhoneNumber,
  findByPhoneNumberId,
} from '@/infrastructure/supabase/repositories/restaurant-repository'
import { extractTemplateStatusWabaId } from '@/infrastructure/whatsapp/webhooks'
import type { LogFn } from '@/domain/ports/whatsapp-webhooks'

export async function resolveRestaurant(
  body: unknown,
  log: LogFn
): Promise<string | null> {
  const phoneNumberId = extractPhoneNumberId(body)
  if (phoneNumberId) {
    const r = await findByPhoneNumberId(phoneNumberId)
    if (r) return r.id
    log('warn', 'webhook.restaurant_not_found', { phoneNumberId })
  }

  const displayPhoneNumber = extractDisplayPhoneNumber(body)
  if (displayPhoneNumber) {
    const r = await findByDisplayPhoneNumber(displayPhoneNumber)
    if (r) return r.id
    log('warn', 'webhook.restaurant_not_found', { displayPhoneNumber })
  }

  const wabaId = extractTemplateStatusWabaId(body)
  if (wabaId) {
    const r = await findByBusinessAccountId(wabaId)
    if (r) return r.id
    log('warn', 'webhook.restaurant_not_found', { wabaId })
    return null
  }

  if (!phoneNumberId && !displayPhoneNumber) {
    log('warn', 'webhook.no_phone_number_id', {})
  }
  return null
}

export function extractPhoneNumberId(body: unknown): string | null {
  const payload = body as Record<string, unknown>

  // Kapso format: conversation.phone_number_id
  const conversation = payload?.conversation as Record<string, unknown> | undefined
  if (conversation?.phone_number_id) {
    return conversation.phone_number_id as string
  }

  // Meta Cloud API formats:
  //   - messages/statuses: entry[].changes[].value.metadata.phone_number_id
  //   - account_update (WAQ-006): entry[].changes[].value.phone_number_id
  const value = firstChangeValue(payload)
  const metadata = value?.metadata as Record<string, unknown> | undefined
  return (
    (metadata?.phone_number_id as string) ??
    (value?.phone_number_id as string) ??
    null
  )
}

export function extractDisplayPhoneNumber(body: unknown): string | null {
  const payload = body as Record<string, unknown>
  const value = firstChangeValue(payload)
  if (!value) return null
  const metadata = value.metadata as Record<string, unknown> | undefined
  return (
    (metadata?.display_phone_number as string) ??
    (value.display_phone_number as string) ??
    null
  )
}

function firstChangeValue(
  payload: Record<string, unknown> | null
): Record<string, unknown> | null {
  if (!payload) return null
  const entry = (payload.entry as Array<Record<string, unknown>>)?.[0]
  const changes = (entry?.changes as Array<Record<string, unknown>>)?.[0]
  const value = changes?.value as Record<string, unknown> | undefined
  return value ?? null
}
