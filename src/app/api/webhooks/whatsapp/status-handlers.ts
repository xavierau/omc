import {
  tryMarkProcessed,
  releaseIdempotencyKey,
} from '@/infrastructure/supabase/idempotency'
import { findMessageByKapsoIdWithRetry } from '@/application/find-message-by-kapso-id'
import { applyStatusUpdate as applyStatusUpdateRepo } from '@/infrastructure/supabase/repositories/whatsapp-message-repository'
import { normalizeStatusPayload } from '@/infrastructure/whatsapp/webhooks'
import { mapStatusUpdate, type KapsoStatusEntry } from './status-mapper'
import type { LogFn } from '@/domain/ports/whatsapp-webhooks'

export { mapStatusUpdate, type KapsoStatusEntry }

/**
 * Iterates every status update on a webhook payload and processes each.
 * Errors per status are isolated so one bad entry does not abort the rest.
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
      log('error', 'webhook.status_handler_error', {
        kapsoMessageId: status.id,
        status: status.status,
        error: String(err),
      })
    }
  }
}

/**
 * Claim-then-process pipeline:
 *   1. Atomically claim `${id}:${status}` so concurrent retries no-op.
 *   2. Look up the outbound row (one bounded retry; covers the §4.2 race).
 *   3. If missing: release the claim and log — Kapso's retry succeeds later.
 *   4. Otherwise: apply the status update via the repository.
 *
 * NOTE: WAQ-002 stops at writing the row. WAQ-003 will read failed rows and
 * dispatch error-code actions (member throttling, ops alerts, etc.).
 */
export async function handleStatusUpdate(
  status: KapsoStatusEntry,
  _restaurantId: string,
  log: LogFn
): Promise<void> {
  const idempotencyKey = `${status.id}:${status.status}`

  const claim = await tryMarkProcessed(idempotencyKey, log)
  if (claim !== 'new') return

  const message = await findMessageByKapsoIdWithRetry(status.id)
  if (!message) {
    await releaseIdempotencyKey(idempotencyKey)
    log('warn', 'status.unknown_message', { kapsoMessageId: status.id })
    return
  }

  const update = mapStatusUpdate(status)
  const updated = await applyStatusUpdateRepo(status.id, update, status.raw)

  if (updated?.snapshot.status === 'failed') {
    log('info', 'webhook.status_failed', {
      kapsoMessageId: status.id,
      errorCode: updated.snapshot.errorCode,
      errorTitle: updated.snapshot.errorTitle,
    })
  }
}
