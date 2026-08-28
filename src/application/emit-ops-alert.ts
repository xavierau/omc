import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import { classifyErrorCode } from '@/domain/value-objects/whatsapp-error-code'
import type { WhatsAppMessage } from '@/domain/entities/whatsapp-message'
import { notifyOpsAlert } from '@/application/notify-ops-alert'
import type {
  AlertKind,
  AlertSeverity,
  OpsAlert,
} from '@/domain/value-objects/ops-alert'

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
 * Records a `whatsapp_error` row on `events` (audit trail) AND fires the
 * WAQ-013 live notifier (Slack) so the right team sees the alert in real time.
 *
 * Failure mode: NEVER throws. The dispatcher above us has already mutated
 * `members.pmm_throttled_until` / `unreachable_at` for the codes that need
 * those mutations; losing an audit row is preferable to surfacing a DB error
 * up to the webhook handler and triggering Kapso retries that double-mutate.
 */
export async function emitOpsAlert(args: EmitOpsAlertArgs): Promise<void> {
  // The console.error fires unconditionally — even if the DB insert below
  // fails, the alert is still observable in stdout for ops triage.
  logAlertToConsole(args)
  await tryInsertAlertRow(args)
  await tryNotify(args)
}

const KIND_MAP: Record<OpsAlertKind, AlertKind> = {
  block_template: 'block_template',
  engineering_alert: 'engineering_alert',
  policy_violation_alert: 'policy_violation',
}

const SEVERITY_MAP: Record<OpsAlertKind, AlertSeverity> = {
  block_template: 'error',
  engineering_alert: 'error',
  policy_violation_alert: 'critical',
}

async function tryNotify(args: EmitOpsAlertArgs): Promise<void> {
  try {
    await notifyOpsAlert(buildNotifierAlert(args))
  } catch (err) {
    console.warn('[ops_alert] notifier_threw', {
      kind: args.kind,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

function buildNotifierAlert(args: EmitOpsAlertArgs): OpsAlert {
  const snapshot = args.message.snapshot
  return {
    kind: KIND_MAP[args.kind],
    severity: SEVERITY_MAP[args.kind],
    restaurantId: args.restaurantId,
    message: snapshot.errorTitle ?? args.kind,
    details: {
      errorCode: snapshot.errorCode,
      kapsoMessageId: snapshot.kapsoMessageId,
      errorDetails: snapshot.errorDetails,
    },
  }
}

function logAlertToConsole(args: EmitOpsAlertArgs): void {
  const { kind, message, restaurantId } = args
  const snapshot = message.snapshot
  console.error('[ops_alert]', kind, {
    restaurantId,
    errorCode: snapshot.errorCode,
    kapsoMessageId: snapshot.kapsoMessageId,
    errorTitle: snapshot.errorTitle,
  })
}

async function tryInsertAlertRow(args: EmitOpsAlertArgs): Promise<void> {
  const { kind } = args
  const row = buildAlertRow(args)
  try {
    const { error } = await createServerSupabaseClient()
      .from('events')
      .insert(row)
    if (error)
      console.error('[ops_alert] events_insert_failed', {
        kind,
        message: error.message,
      })
  } catch (err) {
    console.error('[ops_alert] events_insert_threw', {
      kind,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

function buildAlertRow(args: EmitOpsAlertArgs): Record<string, unknown> {
  const { kind, message, restaurantId } = args
  const snapshot = message.snapshot
  const classification = classifyErrorCode(snapshot.errorCode)
  return {
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
  }
}
