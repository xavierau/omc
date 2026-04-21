import { matchCommand, type CommandRoute } from '@/domain/services/command-keywords'

export type ResolvedRoute =
  | CommandRoute
  | 'JOIN'
  | 'REDEEM_CODE'
  | 'REWARD_REDEEM'
  | 'receipt-image'
  | 'unknown'

export interface RouteResult {
  route: ResolvedRoute
  /** For REDEEM_CODE: the coupon code (uppercased, trimmed). */
  argument?: string
}

/**
 * Classify an inbound message into a structured route.
 *
 * Priority order (first match wins):
 *   1. image type         → 'receipt-image'
 *   2. JOIN / JOIN-<id>   → 'JOIN'
 *   3. REWARD_<id>        → 'REWARD_REDEEM'
 *   4. REDEEM <code>      → 'REDEEM_CODE' with argument
 *   5. matchCommand()     → its result (bare REDEEM / 兌換 → 'REDEEM')
 *   6. fallback           → 'unknown'
 *
 * Pure: no IO, no side effects.
 */
export function resolveRoute(text: string, type: string): RouteResult {
  if (type === 'image') return { route: 'receipt-image' }

  const upper = text.trim().toUpperCase()

  if (upper === 'JOIN' || upper.startsWith('JOIN-')) return { route: 'JOIN' }
  if (upper.startsWith('REWARD_')) return { route: 'REWARD_REDEEM' }

  if (upper.startsWith('REDEEM ')) {
    const argument = upper.replace(/^REDEEM\s+/, '').trim()
    if (argument.length > 0) return { route: 'REDEEM_CODE', argument }
  }

  const command = matchCommand(text)
  if (command) return { route: command }

  return { route: 'unknown' }
}
