import {
  tryMarkProcessed,
  releaseIdempotencyKey,
} from '@/infrastructure/supabase/idempotency'
import { findMessageByKapsoIdWithRetry } from '@/application/find-message-by-kapso-id'
import { applyStatusUpdate as applyStatusUpdateRepo } from '@/infrastructure/supabase/repositories/whatsapp-message-repository'
import { dispatchErrorAction } from '@/application/dispatch-error-action'
import { reconcileCampaignSendFailure } from '@/application/reconcile-campaign-send-failure'
import { normalizeStatusPayload } from '@/infrastructure/whatsapp/webhooks'
import { mapStatusUpdate, type KapsoStatusEntry } from './status-mapper'
import type { LogFn } from '@/domain/ports/whatsapp-webhooks'

export { mapStatusUpdate, type KapsoStatusEntry }

const IDEMPOTENCY_ERROR_PREFIX = 'idempotency.error'

/**
 * Iterates every status update on a webhook payload and processes each.
 * Errors per status are isolated so one bad entry does not abort the rest —
 * EXCEPT idempotency-claim errors, which we re-throw so route.ts can return
 * 500 and Kapso retries the whole webhook (otherwise the status update is
 * permanently lost on a transient DB failure).
 */
export async function routeStatusEvent(
  body: unknown,
  restaurantId: string,
  log: LogFn
): Promise<void> {
  const statuses = normalizeStatusPayload(body)
  log('info', 'webhook.status_event', { count: statuses.length })
  for (const status of statuses) {
    try {
      await handleStatusUpdate(status, restaurantId, log)
    } catch (err) {
      const isIdempotencyError =
        err instanceof Error && err.message.startsWith(IDEMPOTENCY_ERROR_PREFIX)
      log('error', 'webhook.status_handler_error', {
        kapsoMessageId: status.id,
        status: status.status,
        error: String(err),
        retryable: isIdempotencyError,
      })
      // Contract: idempotency errors propagate to route.ts → 500 → Kapso retry.
      if (isIdempotencyError) throw err
    }
  }
}

/**
 * Claim-then-process pipeline:
 *   1. Atomically claim `${id}:${status}` so concurrent retries no-op.
 *   2. Look up the outbound row (one bounded retry; covers the §4.2 race).
 *   3. If missing: release the claim and log — Kapso's retry succeeds later.
 *   4. Otherwise: apply the status update via the repository.
 *   5. On a campaign body flipping to `failed` (#131): retract the campaign's
 *      sent counter — runs BEFORE the error action because it is the billing
 *      write and never throws, whereas a throwing dispatch would skip it.
 *   6. On `failed` with an errorCode: dispatch the §6 error action
 *      (member-state mutation or ops alert).
 */
export async function handleStatusUpdate(
  status: KapsoStatusEntry,
  restaurantId: string,
  log: LogFn
): Promise<void> {
  const idempotencyKey = `${status.id}:${status.status}`

  const claim = await tryMarkProcessed(idempotencyKey, log)
  if (claim === 'duplicate') return
  if (claim === 'error') {
    throw new Error(`${IDEMPOTENCY_ERROR_PREFIX} claim_failed key=${idempotencyKey}`)
  }

  const message = await findMessageByKapsoIdWithRetry(status.id)
  if (!message) {
    await releaseIdempotencyKey(idempotencyKey)
    log('warn', 'status.unknown_message', { kapsoMessageId: status.id })
    return
  }

  const update = mapStatusUpdate(status)
  const updated = await applyStatusUpdateRepo(status.id, update, status.raw)
  if (!updated) return

  await reconcileCampaignSendFailure({ before: message, after: updated, log })

  if (updated.snapshot.status === 'failed' && updated.snapshot.errorCode) {
    await dispatchErrorAction(updated, restaurantId, log)
  }
}
