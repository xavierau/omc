// WAQ-006: tenant resolution for incoming WhatsApp webhooks. Two
// identifier paths are supported because Meta's webhook surface is
// inconsistent:
//   - `phone_number_id` (numeric)        -> messages, statuses, account_update
//   - `display_phone_number` (E.164-ish) -> phone_number_quality_update
// Without the display-number fallback, `phone_number_quality_update`
// events are silently dropped because there is no phone_number_id to
// look up.

import {
  findByDisplayPhoneNumber,
  findByPhoneNumberId,
} from '@/infrastructure/supabase/repositories/restaurant-repository'
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
    return null
  }

  if (!phoneNumberId) log('warn', 'webhook.no_phone_number_id', {})
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
