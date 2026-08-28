import {
  getRestaurantPhoneNumberId,
  getReplyConfig,
} from '@/infrastructure/supabase/repositories/restaurant-repository'
import { findMemberByPhone } from '@/infrastructure/supabase/repositories/member-repository'
import type { ReplyFeatureKey } from '@/domain/services/reply-config'
import { maskPhone } from '@/infrastructure/logging/logger'
import { PhoneNumber } from '@/domain/value-objects/phone-number'
import { handleRedeem, handleUnsubscribe, handleRewards, handleRewardRedeem } from './member-handlers'
import { handleClaim } from './claim-handler'
import {
  maybeHandleLanguageCommand,
  maybeDetectLanguageForExistingMember,
} from './language-handler'
import { resolveRoute, type RouteResult, type ResolvedRoute } from './route-resolver'
import type { KapsoMessage } from '@/infrastructure/whatsapp/webhooks'
import { handleHelp, handleUnknown } from './unknown-help-handlers'
import { handleContact } from './contact-handler'
import { handleContactFormSubmission } from './contact-form-handler'
import { handleMyCard } from './my-card-handler'
import { handleJoin, handleReceiptImage, handlePoints } from './join-and-image-handlers'
import { handleReceiptConfirmation } from './receipt-confirmation'
import { bumpServiceWindow } from './service-window'
import { maybePromptOptin } from './optin-prompt'
import {
  handleOptinConfirmation,
  handleOptinRejection,
} from './optin-confirmation'

type LogFn = (level: 'info' | 'warn' | 'error', event: string, data: unknown) => void
const noop: LogFn = () => {}

export async function routeMessage(message: KapsoMessage, restaurantId: string, log: LogFn = noop) {
  // WAQ-008: every inbound bumps the customer-service window. See
  // `service-window.ts` — the window is anchored on the user's webhook
  // `timestamp`, not server-receive time, and failure is non-fatal.
  await bumpServiceWindow(message, restaurantId, log)

  // WONB-007: side-effect alongside dispatchRoute. Sends an opt-in
  // confirmation template for the first qualifying inbound from a member
  // without strong marketing consent. Never throws — failure is logged
  // and the regular dispatch continues.
  await maybePromptOptin(message, restaurantId, log)

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

  // REPLY-005: a WhatsApp Flow submission carries a structured payload, not
  // free text — route it before `resolveRoute` (pure (text,type) classifier;
  // a structured object has no place in its signature, AD-7).
  if (message.flowResponse) {
    return handleContactFormSubmission({ message, restaurantId, phoneNumberId, phone, log })
  }

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

// REPLY-003: routes whose function a tenant can switch off. A disabled function
// falls through to the "didn't understand" reply instead of its real handler.
// Note the split: bare REDEEM / 兌換 ("view rewards") is a rewards route, while
// REDEEM <code> ("use a coupon") is REDEEM_CODE.
const ROUTE_FEATURE: Partial<Record<ResolvedRoute, ReplyFeatureKey>> = {
  POINTS: 'points',
  REWARDS: 'rewards',
  REDEEM: 'rewards',
  REWARD_REDEEM: 'rewards',
  REDEEM_CODE: 'redeem',
  MY_CARD: 'card',
}

async function dispatchByRoute(ctx: DispatchContext) {
  const { resolved, message, restaurantId, phone, phoneNumberId, log } = ctx

  const gatedFeature = ROUTE_FEATURE[resolved.route]
  if (gatedFeature) {
    const config = await getReplyConfig(restaurantId)
    // Gate only on an explicit disable; a missing/degraded config leaves the
    // function enabled (fail toward today's behavior).
    if (config?.features?.[gatedFeature] === false) {
      return handleUnknown(phoneNumberId, phone, restaurantId)
    }
  }

  switch (resolved.route) {
    case 'JOIN':
      return handleJoin({ message, restaurantId, phone, phoneNumberId, log })
    case 'POINTS':
      return handlePoints(phoneNumberId, phone, restaurantId)
    case 'HELP':
      return handleHelp(phoneNumberId, phone, restaurantId)
    case 'CONTACT':
      return handleContact(phoneNumberId, phone, restaurantId)
    case 'MY_CARD':
      return handleMyCard(phoneNumberId, phone, restaurantId)
    case 'STOP':
      return handleUnsubscribe(phoneNumberId, phone, restaurantId)
    case 'REWARDS':
    case 'REDEEM':
      return handleRewards(phoneNumberId, phone, restaurantId)
    case 'REDEEM_CODE':
      return handleRedeem(phoneNumberId, phone, resolved.argument ?? '', restaurantId)
    case 'REWARD_REDEEM':
      return handleRewardRedeem(phoneNumberId, phone, extractRewardId(message.text), restaurantId)
    case 'CLAIM':
      return handleClaim({ phoneNumberId, phone, campaignId: resolved.argument ?? '', restaurantId, log })
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
  // Q-G: receipt confirmation wins YES.
  const receiptHandled = await handleReceiptConfirmation({
    phoneNumberId,
    phone,
    route,
    restaurantId,
    text: route === null ? (message.text ?? '') : undefined,
  })
  if (receiptHandled) return

  // WONB-007: opt-in YES/NO only when receipt didn't claim the route.
  const optinCtx = { phoneNumberId, phone, restaurantId }
  if (route === 'YES' && (await handleOptinConfirmation(optinCtx))) return
  if (route === 'NO' && (await handleOptinRejection(optinCtx))) return

  return handleUnknown(phoneNumberId, phone, restaurantId)
}

function extractRewardId(rawText: string | undefined): string {
  return (rawText ?? '').trim().toUpperCase().replace('REWARD_', '').toLowerCase()
}
