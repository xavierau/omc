import { clearMemberUnreachable } from '@/infrastructure/supabase/repositories/member-quality-state'
import { emitEvent } from './emit-event'

// Narrow LogFn (no 'critical') so both the route's and handlers' loggers fit.
type LogFn = (level: 'info' | 'warn' | 'error', event: string, data: unknown) => void

/**
 * MEM-004: an inbound message from a contact proves the WhatsApp account works
 * again (131026 is not permanent), so clear `members.unreachable_at` and record
 * a `reachability_restored` event. Only the cleared case emits (the clear is
 * conditional). NEVER throws — inbound processing must not depend on this.
 *
 * Returns true when a flag was cleared. `pmm_throttled_until` and consent are
 * deliberately untouched.
 */
export async function restoreMemberReachability(
  args: { restaurantId: string; phoneE164: string; messageType: string },
  log: LogFn
): Promise<boolean> {
  const { restaurantId, phoneE164, messageType } = args
  let cleared
  try {
    cleared = await clearMemberUnreachable(restaurantId, phoneE164)
  } catch (err) {
    log('warn', 'reachability.restore_failed', { error: String(err) })
    console.warn('[reachability] restore failed:', err)
    return false
  }
  if (!cleared) return false

  try {
    await emitEvent({
      restaurantId,
      memberId: cleared.memberId,
      type: 'reachability_restored',
      dataJson: {
        previous_unreachable_at: cleared.previousUnreachableAt,
        trigger_message_type: messageType,
      },
    })
  } catch (err) {
    log('warn', 'reachability.event_failed', { error: String(err) })
    console.warn('[reachability] event failed:', err)
  }
  return true
}
