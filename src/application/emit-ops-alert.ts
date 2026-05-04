import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import { classifyErrorCode } from '@/domain/value-objects/whatsapp-error-code'
import type { WhatsAppMessage } from '@/domain/entities/whatsapp-message'

export type OpsAlertKind =
  | 'block_template'
  | 'engineering_alert'
  | 'policy_violation_alert'

export interface EmitOpsAlertArgs {
  kind: OpsAlertKind
  message: WhatsAppMessage
  restaurantId: string
}

/**
 * Records a `whatsapp_error` row on `events` and emits a `[ops_alert]`
 * `console.error` line for log aggregators.
 *
 * Failure mode: NEVER throws. The dispatcher above us has already mutated
 * `members.pmm_throttled_until` / `unreachable_at` for the codes that need
 * those mutations; losing an audit row is preferable to surfacing a DB error
 * up to the webhook handler and triggering Kapso retries that double-mutate.
 *
 * Real Slack/email/PagerDuty integration lands in WAQ-013. Until then the
 * `events` row + console line are the audit trail.
 */
export async function emitOpsAlert(args: EmitOpsAlertArgs): Promise<void> {
  const { kind, message, restaurantId } = args
  const snapshot = message.snapshot
  const classification = classifyErrorCode(snapshot.errorCode)

  // The console.error fires unconditionally — even if the DB insert below
  // fails, the alert is still observable in stdout for ops triage.
  console.error('[ops_alert]', kind, {
    restaurantId,
    errorCode: snapshot.errorCode,
    kapsoMessageId: snapshot.kapsoMessageId,
    errorTitle: snapshot.errorTitle,
  })

  try {
    const supabase = createServerSupabaseClient()
    const { error } = await supabase.from('events').insert({
      restaurant_id: restaurantId,
      type: 'whatsapp_error',
      data_json: {
        kind,
        error_code: snapshot.errorCode,
        action: classification.action,
        kapso_message_id: snapshot.kapsoMessageId,
        error_title: snapshot.errorTitle,
        error_details: snapshot.errorDetails,
      },
    })
    if (error) {
      console.error('[ops_alert] events_insert_failed', {
        kind,
        message: error.message,
      })
    }
  } catch (err) {
    console.error('[ops_alert] events_insert_threw', {
      kind,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
