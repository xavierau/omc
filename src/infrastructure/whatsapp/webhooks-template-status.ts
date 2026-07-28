// TPL-009: template-status classification + extraction. Meta forwards a
// `message_template_status_update` field per entry.changes[]; Kapso may
// flatten it (both variants supported defensively — see below), mirroring
// the quality-event convention in webhooks-quality.ts.

import { readEventTimestamp } from './webhooks-quality-timestamp'

const TEMPLATE_STATUS_FIELD = 'message_template_status_update'

export interface TemplateStatusWebhookEntry {
  wabaId: string | null
  metaTemplateId: string | null
  templateName: string | null
  language: string | null
  event: string
  reason: string | null
  // Read order in webhooks-quality-timestamp.ts. Not used for a stale-event
  // guard here — this feature is plain last-write-wins (plan decision).
  eventTimestamp?: string
  raw: Record<string, unknown>
}

export function hasMetaTemplateStatus(obj: Record<string, unknown>): boolean {
  return allChanges(obj).some((c) => c.change.field === TEMPLATE_STATUS_FIELD)
}

export function hasKapsoFlatTemplateStatus(
  obj: Record<string, unknown>
): boolean {
  // Two guessed flat shapes (unverified, plan Risks #2; unmatched falls
  // through to `[]`/null, fail-safe): `event`+`data` (mirrors quality), or
  // Meta's own `field`/`event` pair with no `data` wrapper — `field` avoids
  // colliding with the actual per-template `event` value.
  return obj.event === TEMPLATE_STATUS_FIELD || obj.field === TEMPLATE_STATUS_FIELD
}

export function extractTemplateStatusEvents(
  body: unknown
): TemplateStatusWebhookEntry[] {
  if (!body || typeof body !== 'object') return []
  const obj = body as Record<string, unknown>
  const fromMeta = extractMetaTemplateStatus(obj)
  if (fromMeta.length > 0) return fromMeta
  const fromKapso = extractKapsoFlatTemplateStatus(obj)
  return fromKapso ? [fromKapso] : []
}

// Non-null ONLY for template-status-shaped payloads (shape-gated) — used as
// the resolver's third, last rung; a false positive would misroute
// existing inbound/status/quality traffic.
export function extractTemplateStatusWabaId(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null
  const obj = body as Record<string, unknown>
  if (!hasMetaTemplateStatus(obj) && !hasKapsoFlatTemplateStatus(obj)) {
    return null
  }
  return extractTemplateStatusEvents(obj)[0]?.wabaId ?? null
}

function extractMetaTemplateStatus(
  obj: Record<string, unknown>
): TemplateStatusWebhookEntry[] {
  // Meta can batch multiple template-status changes per webhook; iterate
  // every matching change so none are silently dropped.
  return allChanges(obj)
    .filter((c) => c.change.field === TEMPLATE_STATUS_FIELD)
    .map((c) =>
      toTemplateStatusEntry(
        (c.change.value ?? {}) as Record<string, unknown>,
        c.entryId,
        c.entryTime
      )
    )
}

function extractKapsoFlatTemplateStatus(
  obj: Record<string, unknown>
): TemplateStatusWebhookEntry | null {
  if (obj.event === TEMPLATE_STATUS_FIELD) {
    const data = (obj.data as Record<string, unknown> | undefined) ?? obj
    return toTemplateStatusEntry(data, undefined, undefined)
  }
  if (obj.field === TEMPLATE_STATUS_FIELD) {
    return toTemplateStatusEntry(obj, undefined, undefined)
  }
  return null
}

interface ChangeWithEntryContext {
  change: Record<string, unknown>
  // entry[].id (WABA id) / entry[].time, propagated to every change.
  entryId: unknown
  entryTime: unknown
}

function allChanges(obj: Record<string, unknown>): ChangeWithEntryContext[] {
  const entries = Array.isArray(obj.entry) ? obj.entry : []
  const out: ChangeWithEntryContext[] = []
  for (const entry of entries) {
    const e = entry as Record<string, unknown> | undefined
    const changes = Array.isArray(e?.changes) ? (e!.changes as unknown[]) : []
    const entryId = e?.id
    const entryTime = e?.time
    for (const change of changes) {
      if (change && typeof change === 'object') {
        out.push({ change: change as Record<string, unknown>, entryId, entryTime })
      }
    }
  }
  return out
}

function toTemplateStatusEntry(
  value: Record<string, unknown>,
  entryId: unknown,
  entryTime: unknown
): TemplateStatusWebhookEntry {
  return {
    wabaId:
      readString(entryId) ?? readString(value.waba_id) ??
      readString(value.whatsapp_business_account_id) ?? null,
    metaTemplateId: readTemplateId(value.message_template_id),
    templateName: readString(value.message_template_name) ?? null,
    language: readString(value.message_template_language) ?? null,
    event: readString(value.event) ?? '',
    reason: readReason(value.reason),
    eventTimestamp: readEventTimestamp(value, entryTime),
    raw: value,
  }
}

// Meta sends `message_template_id` as a NUMBER; normalise to string.
function readTemplateId(raw: unknown): string | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw)
  if (typeof raw === 'string' && raw.length > 0) return raw
  return null
}

// Meta ships literal "NONE" (not absence) for no rejection reason.
function readReason(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  if (raw.length === 0 || raw === 'NONE') return null
  return raw
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}
