// WAQ-009: dispatcher between Meta quality webhooks and tenant settings.
//
// Wired into `handleQualityEntry` AFTER the row is persisted to
// tenant_quality_state. Reads `decideQualityAction(prev, next)` and applies
// the side effect — throttle, pause, recovery-pending event, or no-op.
//
// IMPORTANT: this dispatcher is best-effort. A repo write failure must NOT
// crash the webhook handler — the transition row is already persisted, and
// the next event can re-attempt the dispatch. We log + swallow.
//
// `manual_recovery_required` is intentionally NOT auto-clearing: per Q1
// resolution we record an `events` row for ops to manually clear via the
// platform-admin override (clearTenantAutoQualityFlags).

import {
  decideQualityAction,
  type QualityAction,
} from '@/domain/value-objects/quality-action'
import type { QualityRating } from '@/domain/value-objects/quality-rating'
import type { LogFn } from '@/domain/ports/whatsapp-webhooks'
import {
  applyAutoThrottle,
  applyAutoPause,
} from '@/infrastructure/supabase/repositories/quality-auto-flags'
import { createEvent } from '@/infrastructure/supabase/repositories/event-repository'

export interface DispatchQualityActionArgs {
  restaurantId: string
  prevRating: QualityRating | null
  nextRating: QualityRating
  log: LogFn
}

export async function dispatchQualityAction(
  args: DispatchQualityActionArgs
): Promise<void> {
  const action = decideQualityAction({
    prevRating: args.prevRating,
    nextRating: args.nextRating,
  })
  try {
    await applyAction(args, action)
  } catch (err) {
    args.log('error', 'webhook.quality_action_failed', {
      restaurantId: args.restaurantId,
      action: action.kind,
      prevRating: args.prevRating,
      nextRating: args.nextRating,
      error: err instanceof Error ? err.message : String(err),
    })
    // Best-effort: do NOT re-throw. Webhook handler must continue so the
    // tenant_quality_state row insert isn't rolled back by an upstream throw,
    // and so Kapso doesn't retry endlessly on transient DB errors.
  }
  args.log('info', 'webhook.quality_action', toLogPayload(args, action))
}

async function applyAction(
  args: DispatchQualityActionArgs,
  action: QualityAction
): Promise<void> {
  if (action.kind === 'throttle') {
    await applyAutoThrottle(args.restaurantId, action.factor)
    return
  }
  if (action.kind === 'pause') {
    await applyAutoPause(args.restaurantId, action.reason)
    return
  }
  if (action.kind === 'manual_recovery_required') {
    await emitRecoveryEvent(args)
  }
}

async function emitRecoveryEvent(
  args: DispatchQualityActionArgs
): Promise<void> {
  try {
    await createEvent({
      restaurantId: args.restaurantId,
      memberId: null,
      type: 'quality_recovery_pending',
      dataJson: {
        prevRating: args.prevRating,
        nextRating: args.nextRating,
        restaurantId: args.restaurantId,
      },
      source: 'webhook.quality',
    })
  } catch (err) {
    args.log('warn', 'webhook.quality_action_event_insert_failed', {
      restaurantId: args.restaurantId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

function toLogPayload(
  args: DispatchQualityActionArgs,
  action: QualityAction
): Record<string, unknown> {
  const base = {
    restaurantId: args.restaurantId,
    prevRating: args.prevRating,
    nextRating: args.nextRating,
    kind: action.kind,
  }
  if (action.kind === 'throttle') {
    return { ...base, factor: action.factor, reason: action.reason }
  }
  if (action.kind === 'pause') {
    return { ...base, reason: action.reason }
  }
  return base
}
