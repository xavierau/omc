// TPL-009: Meta `message_template_status_update` webhook handler. Mirrors
// the WAQ-006 quality-handlers.ts claim-then-process posture.
//
// IDEMPOTENCY CONTRACT — same posture as quality-handlers.ts:
//   - 'duplicate'  -> return (Kapso replay no-op)
//   - 'error'      -> throw idempotency.error so route.ts returns 500 and
//                     Kapso retries (a transient DB blip must not lose the
//                     transition).
//
// Per-entry error isolation mirrors status-handlers.ts: non-idempotency
// errors on one entry must not abort the remaining entries in a batched
// payload; idempotency errors propagate so the whole webhook is retried.
//
// Ordering judgement call: the plan's Test Plan requires an unmapped event
// to skip template lookup entirely ("no lookup/update"), so the event is
// mapped to a local TemplateStatus BEFORE resolving the template — not
// after, as a literal reading of the prose walkthrough might suggest.

import { tryMarkProcessed } from '@/infrastructure/supabase/idempotency'
import {
  findByMetaTemplateId,
  findByNameAndLanguage,
  update as updateTemplate,
} from '@/infrastructure/supabase/repositories/whatsapp-template-repository'
import { extractTemplateStatusEvents } from '@/infrastructure/whatsapp/webhooks'
import type { TemplateStatusWebhookEntry } from '@/infrastructure/whatsapp/webhooks'
import {
  mapMetaTemplateStatus,
  SYNCABLE_STATUSES,
  NO_REJECTION_REASON,
} from '@/domain/services/meta-template-status'
import type {
  TemplateStatus,
  WhatsAppTemplate,
} from '@/domain/entities/whatsapp-template'
import type { LogFn } from '@/domain/ports/whatsapp-webhooks'
import { buildTemplateStatusIdempotencyKey } from './template-status-idempotency'

const IDEMPOTENCY_ERROR_PREFIX = 'idempotency.error'

export async function routeTemplateStatusEvent(
  body: unknown,
  restaurantId: string,
  log: LogFn
): Promise<void> {
  const events = extractTemplateStatusEvents(body)
  log('info', 'webhook.template_status_count', { count: events.length })
  for (const entry of events) {
    try {
      await handleTemplateStatusEntry(entry, restaurantId, log)
    } catch (err) {
      const isIdempotencyError =
        err instanceof Error && err.message.startsWith(IDEMPOTENCY_ERROR_PREFIX)
      log('error', 'webhook.template_status_handler_error', {
        metaTemplateId: entry.metaTemplateId,
        event: entry.event,
        error: String(err),
        retryable: isIdempotencyError,
      })
      // Contract: idempotency errors propagate to route.ts -> 500 -> retry.
      if (isIdempotencyError) throw err
    }
  }
}

async function handleTemplateStatusEntry(
  entry: TemplateStatusWebhookEntry,
  restaurantId: string,
  log: LogFn
): Promise<void> {
  const idempotencyKey = buildTemplateStatusIdempotencyKey(restaurantId, entry)
  const claim = await tryMarkProcessed(idempotencyKey, log)
  if (claim === 'duplicate') return
  if (claim === 'error') {
    throw new Error(`${IDEMPOTENCY_ERROR_PREFIX} claim_failed key=${idempotencyKey}`)
  }

  const newStatus = mapMetaTemplateStatus(entry.event)
  if (!newStatus) {
    log('info', 'webhook.template_status_unmapped', { event: entry.event })
    return
  }

  const template = await resolveTemplate(entry, restaurantId)
  if (!template) {
    log('warn', 'webhook.template_not_found', {
      metaTemplateId: entry.metaTemplateId,
      templateName: entry.templateName,
      language: entry.language,
    })
    return
  }

  await applyStatusUpdate(template, newStatus, entry, log)
}

async function resolveTemplate(
  entry: TemplateStatusWebhookEntry,
  restaurantId: string
): Promise<WhatsAppTemplate | null> {
  if (entry.metaTemplateId) {
    const byMetaId = await findByMetaTemplateId(restaurantId, entry.metaTemplateId)
    if (byMetaId) return byMetaId
  }
  if (entry.templateName && entry.language) {
    return findByNameAndLanguage(restaurantId, entry.templateName, entry.language)
  }
  return null
}

/**
 * Write-guard invariant: a status write is applied ONLY when the resolved
 * row's current status is syncable (pending/approved/paused) AND the
 * mapped status differs. This keeps draft/rejected/disabled/deleted rows
 * untouchable and suppresses no-op writes. Plain last-write-wins — no
 * event-time guard — because the 15-min cron re-reads live Meta state and
 * self-heals any webhook misordering (plan: Ordering/staleness rule).
 */
async function applyStatusUpdate(
  template: WhatsAppTemplate,
  newStatus: TemplateStatus,
  entry: TemplateStatusWebhookEntry,
  log: LogFn
): Promise<void> {
  if (!SYNCABLE_STATUSES.includes(template.status)) return
  if (newStatus === template.status) return

  await updateTemplate(template.id, {
    status: newStatus,
    ...(newStatus === 'rejected' && {
      rejectionReason: entry.reason ?? NO_REJECTION_REASON,
    }),
  })
  log('info', 'webhook.template_status_updated', {
    templateId: template.id,
    oldStatus: template.status,
    newStatus,
  })
}
