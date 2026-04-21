/**
 * Classify an inbound message into a route name for structured logging.
 * Pure: no IO, no side effects, so it can be unit-tested in isolation.
 */
export function resolveRoute(text: string, type: string): string {
  if (text === 'JOIN' || text.startsWith('JOIN-')) return 'JOIN'
  if (text === 'POINTS') return 'POINTS'
  if (text.startsWith('REDEEM ')) return 'REDEEM'
  if (text === 'REWARD' || text === 'REWARDS') return 'REWARDS'
  if (text.startsWith('REWARD_')) return 'REWARD_REDEEM'
  if (text === 'STOP') return 'STOP'
  if (type === 'image') return 'receipt-image'
  return 'unknown'
}
