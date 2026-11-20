import { promptMarketingOptin } from '@/application/prompt-marketing-optin'
import { PhoneNumber } from '@/domain/value-objects/phone-number'
import { resolveRoute } from './route-resolver'
import type { KapsoMessage } from '@/infrastructure/whatsapp/webhooks'

type LogFn = (
  level: 'info' | 'warn' | 'error',
  event: string,
  data: unknown
) => void

/**
 * WONB-007: side-effect alongside `dispatchRoute`. Sends the inbound-first
 * opt-in confirmation template when the inbound qualifies. NEVER throws —
 * webhook reliability is the paramount invariant; opt-in prompting is a
 * fire-and-forget enhancement on top of the regular flow.
 */
export async function maybePromptOptin(
  message: KapsoMessage,
  restaurantId: string,
  log: LogFn
): Promise<void> {
  if (!isPromptable(message)) {
    log('info', 'optin.skip', { reason: 'system_keyword' })
    return
  }
  try {
    const result = await promptMarketingOptin({
      restaurantId,
      phoneE164: PhoneNumber.create(message.from).value,
      source: `inbound_first_${message.messageId}`,
    })
    if (result.promptSent) {
      log('info', 'optin.sent', { messageId: message.messageId })
      return
    }
    log('info', 'optin.skip', { reason: result.reason })
  } catch (err) {
    log('error', 'optin.prompt_failed', { error: String(err) })
  }
}

/**
 * Operational interpretation of "is system keyword" (Q-F clarification):
 * Only the `unknown` route triggers the opt-in prompt. JOIN / STOP / HELP /
 * POINTS / REWARDS / REDEEM and YES / NO are all considered system keywords
 * for this gate — keyword-shaped messages are noisy proxies for opt-in
 * intent and we prefer to send the prompt only on a free-form first
 * contact. This is stricter than the AC reads literally but mirrors the
 * deployed product behaviour and is the contract reviewers approved.
 */
function isPromptable(message: KapsoMessage): boolean {
  if (message.type !== 'text') return false
  const route = resolveRoute(message.text ?? '', message.type).route
  return route === 'unknown'
}
