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
  // The tenant was resolved from entry[0]'s WABA, but Meta may batch
  // changes from several entries. Any entry naming a DIFFERENT WABA belongs
  // to another tenant and must not be processed under this restaurantId:
  // its meta-id lookup would miss and — template names being tenant-scoped
  // and highly collision-prone (`offer_promotion`, `hello_world`) — a
  // name-keyed match would write another tenant's row. The wamid-keyed
  // status/inbound handlers can't collide this way; this path can.
  const resolvingWabaId = events[0]?.wabaId ?? null
  for (const entry of events) {
    if (entry.wabaId !== resolvingWabaId) {
      log('warn', 'webhook.template_status_foreign_waba', {
        entryWabaId: entry.wabaId,
        resolvingWabaId,
        metaTemplateId: entry.metaTemplateId,
      })
      continue
    }
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

  await applyStatusUpdate(template, newStatus, log)
}

/**
 * The name+language fallback is gated on the payload carrying NO meta id —
 * never on a meta-id *miss*. Every write that puts a row into a syncable
 * status also sets `meta_template_id` in the same statement (create /
 * update / resubmit); the only rows without one are `draft` and `rejected`,
 * which the FROM-guard already blocks. So a miss does not mean "the id
 * hasn't landed yet" — it means this event belongs to a DIFFERENT Meta
 * template, and falling back on name+language would attach it to the wrong
 * row. Concretely: editing an approved template submits a new Meta id Y and
 * resets the row to pending/Y; a late APPROVED for the old id X would
 * otherwise flip that row to approved and let campaigns send on a template
 * Meta never approved.
 */
async function resolveTemplate(
  entry: TemplateStatusWebhookEntry,
  restaurantId: string
): Promise<WhatsAppTemplate | null> {
  if (entry.metaTemplateId) {
    return findByMetaTemplateId(restaurantId, entry.metaTemplateId)
  }
  if (entry.templateName && entry.language) {
    return findByNameAndLanguage(restaurantId, entry.templateName, entry.language)
  }
  return null
}

/**
 * Write-guard invariant, BOTH directions:
 *
 *   FROM — the resolved row's current status must be syncable
 *   (pending/approved/paused), keeping draft/rejected/disabled/deleted rows
 *   untouchable, and no-op writes suppressed.
 *
 *   TO — the mapped status must ALSO be syncable. This is what makes plain
 *   last-write-wins safe. LWW is only defensible because the 15-min cron
 *   re-reads LIVE Meta state and repairs any webhook misordering — but the
 *   cron itself only considers syncable rows. A webhook writing a terminal
 *   status (rejected/disabled) would therefore drop the row out of the
 *   cron's reach permanently: one stale REJECTED landing after a real
 *   APPROVED would brick that template forever, with Meta saying APPROVED
 *   and us refusing to send. Restricting webhook writes to statuses the
 *   cron can still revisit keeps the self-healing property true by
 *   construction, at the cost of ≤15 min latency on rejections — which
 *   unblock nothing, unlike approvals.
 *
 * Terminal transitions are therefore logged and left to the cron, which
 * reads authoritative live state and so can never persist a stale one
 * (it also owns the rejection_reason write — see sync-template-status.ts).
 *
 * The cron's reach has two further preconditions worth stating, because
 * this design leans on them: it only considers rows whose
 * `metaTemplateId` is non-null, and `syncSingleTemplate` matches Meta's
 * list by NAME+LANGUAGE rather than by meta id. If Meta ever stops
 * listing a template it has DISABLED, a deferred DISABLED would never be
 * persisted and the row would sit locally `approved` and sendable. Both
 * hold today; neither is enforced here.
 */
async function applyStatusUpdate(
  template: WhatsAppTemplate,
  newStatus: TemplateStatus,
  log: LogFn
): Promise<void> {
  // Logged, not silent: without this an operator asking "why didn't my
  // template update?" sees template_status_count:1 and then nothing at all.
  if (
    !SYNCABLE_STATUSES.includes(template.status) ||
    newStatus === template.status
  ) {
    log('info', 'webhook.template_status_skipped', {
      templateId: template.id,
      oldStatus: template.status,
      newStatus,
    })
    return
  }

  if (!SYNCABLE_STATUSES.includes(newStatus)) {
    log('info', 'webhook.template_status_deferred_to_cron', {
      templateId: template.id,
      oldStatus: template.status,
      newStatus,
    })
    return
  }

  await updateTemplate(template.id, { status: newStatus })
  log('info', 'webhook.template_status_updated', {
    templateId: template.id,
    oldStatus: template.status,
    newStatus,
  })
}
