import { matchCommand, type CommandRoute } from '@/domain/services/command-keywords'

const CHINESE_JOIN_ALIASES = ['加入', '入會', '註冊'] as const

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

  const trimmed = text.trim()
  const upper = trimmed.toUpperCase()

  if (upper === 'JOIN' || upper.startsWith('JOIN-')) return { route: 'JOIN' }
  if ((CHINESE_JOIN_ALIASES as readonly string[]).includes(trimmed)) {
    return { route: 'JOIN' }
  }
  if (upper.startsWith('REWARD_')) return { route: 'REWARD_REDEEM' }

  // Accept both English "REDEEM <code>" and Chinese "兌換 <代碼>" prefixes.
  // English path uses the uppercased form (existing behavior: code returned
  // uppercase). Chinese path uses the trimmed form — 兌換 is CJK, so
  // uppercasing is a no-op, but operating on `trimmed` keeps intent explicit.
  const redeemMatch =
    upper.match(/^REDEEM\s+(.+)$/) ?? trimmed.match(/^兌換\s+(.+)$/)
  if (redeemMatch && redeemMatch[1]?.trim()) {
    return { route: 'REDEEM_CODE', argument: redeemMatch[1].trim() }
  }

  const command = matchCommand(text)
  if (command) return { route: command }

  return { route: 'unknown' }
}
