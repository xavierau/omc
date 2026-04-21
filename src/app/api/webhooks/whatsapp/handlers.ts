import { getRestaurantPhoneNumberId } from '@/infrastructure/supabase/repositories/restaurant-repository'
import { findMemberByPhone } from '@/infrastructure/supabase/repositories/member-repository'
import { maskPhone } from '@/infrastructure/logging/logger'
import { PhoneNumber } from '@/domain/value-objects/phone-number'
import { handleRedeem, handleUnsubscribe, handleRewards, handleRewardRedeem } from './member-handlers'
import {
  maybeHandleLanguageCommand,
  maybeDetectLanguageForExistingMember,
} from './language-handler'
import { resolveRoute, type RouteResult } from './route-resolver'
import type { KapsoMessage } from '@/infrastructure/whatsapp/webhooks'
import { handleHelp, handleUnknown } from './unknown-help-handlers'
import { handleJoin, handleReceiptImage, handlePoints } from './join-and-image-handlers'
import { handleReceiptConfirmation } from './receipt-confirmation'

type LogFn = (level: 'info' | 'warn' | 'error', event: string, data: unknown) => void
const noop: LogFn = () => {}

export async function routeMessage(message: KapsoMessage, restaurantId: string, log: LogFn = noop) {
  if (await maybeHandleLanguageCommand(message, restaurantId)) return

  // Preload the member ONCE for text messages so silent script-based
  // detection below reuses the row instead of issuing a second query.
  // Non-text messages never trigger silent-detect, so skip the lookup.
  const preloadedMember = message.type === 'text'
    ? await findMemberByPhone(restaurantId, PhoneNumber.create(message.from).value)
    : null

  const result = await dispatchRoute(message, restaurantId, log)

  // Silent script-based detection runs AFTER routing so it can never block
  // the primary flow. Only persists when the pre-loaded member exists and
  // has no preferred_language set.
  try {
    await maybeDetectLanguageForExistingMember(
      preloadedMember,
      restaurantId,
      message.type === 'text' ? message.text : null
    )
  } catch (err) {
    log('warn', 'handler.language_detection_failed', { error: String(err) })
  }

  return result
}

async function dispatchRoute(message: KapsoMessage, restaurantId: string, log: LogFn) {
  const text = message.text ?? ''
  const phone = PhoneNumber.create(message.from).value
  const phoneNumberId = await getRestaurantPhoneNumberId(restaurantId)
  const resolved = resolveRoute(text, message.type)
  log('info', 'handler.route', { route: resolved.route, phone: maskPhone(phone) })

  return dispatchByRoute({ resolved, message, restaurantId, phone, phoneNumberId, log })
}

interface DispatchContext {
  resolved: RouteResult
  message: KapsoMessage
  restaurantId: string
  phone: string
  phoneNumberId: string
  log: LogFn
}

async function dispatchByRoute(ctx: DispatchContext) {
  const { resolved, message, restaurantId, phone, phoneNumberId, log } = ctx

  switch (resolved.route) {
    case 'JOIN':
      return handleJoin({ message, restaurantId, phone, phoneNumberId, log })
    case 'POINTS':
      return handlePoints(phoneNumberId, phone, restaurantId)
    case 'HELP':
      return handleHelp(phoneNumberId, phone, restaurantId)
    case 'STOP':
      return handleUnsubscribe(phoneNumberId, phone, restaurantId)
    case 'REWARDS':
    case 'REDEEM':
      return handleRewards(phoneNumberId, phone, restaurantId)
    case 'REDEEM_CODE':
      return handleRedeem(phoneNumberId, phone, resolved.argument ?? '', restaurantId)
    case 'REWARD_REDEEM':
      return handleRewardRedeem(phoneNumberId, phone, extractRewardId(message.text), restaurantId)
    case 'receipt-image':
      return handleReceiptImage(phoneNumberId, phone, restaurantId, message.imageUrl, message.imageId)
    case 'YES':
    case 'NO':
      return dispatchConfirmation(ctx, resolved.route)
    default:
      return dispatchConfirmation(ctx, null)
  }
}

async function dispatchConfirmation(
  ctx: DispatchContext,
  route: 'YES' | 'NO' | null
) {
  const { message, restaurantId, phone, phoneNumberId } = ctx
  const handled = await handleReceiptConfirmation({
    phoneNumberId,
    phone,
    route,
    restaurantId,
    text: route === null ? (message.text ?? '') : undefined,
  })
  if (handled) return
  return handleUnknown(phoneNumberId, phone, restaurantId)
}

function extractRewardId(rawText: string | undefined): string {
  return (rawText ?? '').trim().toUpperCase().replace('REWARD_', '').toLowerCase()
}
