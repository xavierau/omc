import { classifyErrorCode } from '@/domain/value-objects/whatsapp-error-code'
import {
  throttleMemberPmm,
  markMemberUnreachable,
} from '@/infrastructure/supabase/repositories/member-quality-state'
import { emitOpsAlert } from './emit-ops-alert'
import type { WhatsAppMessage } from '@/domain/entities/whatsapp-message'
import type { LogFn } from '@/domain/ports/whatsapp-webhooks'

const PMM_COOLDOWN_HOURS = 24

/**
 * Routes a `failed` WhatsApp message through the §6.1 dispatch table.
 *
 * Side effects per action:
 * - throttle_recipient_24h (131049): set members.pmm_throttled_until
 * - mark_recipient_unreachable (131026): set members.unreachable_at
 * - block_template / engineering_alert / policy_violation_alert: emitOpsAlert
 * - reduce_batch_size / backoff_and_retry / log_only: structured log only
 *
 * Always emits a `whatsapp.error_dispatched` structured log line with the
 * classification severity, even on log-only branches.
 *
 * Critical guards:
 * - `internal_orphan` is forensic noise from the reconciliation sweep; it
 *   maps to `log_only` so we never mutate `members` for a row whose Meta
 *   delivery state we genuinely don't know.
 * - `memberId === null` on a member-mutation branch is a no-op (member was
 *   deleted between send and webhook); we log and return rather than crash.
 */
export async function dispatchErrorAction(
  message: WhatsAppMessage,
  restaurantId: string,
  log: LogFn
): Promise<void> {
  const snapshot = message.snapshot
  const classification = classifyErrorCode(snapshot.errorCode)

  await applyAction({ message, restaurantId, classification })

  log(classification.severity, 'whatsapp.error_dispatched', {
    code: classification.code,
    action: classification.action,
    restaurantId,
    kapsoMessageId: snapshot.kapsoMessageId,
  })
}

type Classification = ReturnType<typeof classifyErrorCode>

async function applyAction(args: {
  message: WhatsAppMessage
  restaurantId: string
  classification: Classification
}): Promise<void> {
  const { message, restaurantId, classification } = args
  const action = classification.action
  if (action === 'throttle_recipient_24h' || action === 'mark_recipient_unreachable') {
    await applyMemberMutation(action, message, restaurantId)
    return
  }
  if (
    action === 'block_template' ||
    action === 'engineering_alert' ||
    action === 'policy_violation_alert'
  ) {
    await emitOpsAlert({ kind: action, message, restaurantId })
    return
  }
  // reduce_batch_size | backoff_and_retry | log_only — structured log only.
}

async function applyMemberMutation(
  action: 'throttle_recipient_24h' | 'mark_recipient_unreachable',
  message: WhatsAppMessage,
  restaurantId: string
): Promise<void> {
  const memberId = message.snapshot.memberId
  if (!memberId) return
  if (action === 'throttle_recipient_24h') {
    await throttleMemberPmm(memberId, restaurantId, PMM_COOLDOWN_HOURS)
    return
  }
  await markMemberUnreachable(memberId, restaurantId)
}
