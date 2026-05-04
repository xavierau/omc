import { normalizeWebhook } from '@kapso/whatsapp-cloud-api/server'
import { getWebhookProvider } from './provider-factory'
import {
  extractQualityEvent,
  hasKapsoFlatQuality,
  hasMetaQuality,
  type QualityWebhookEntry,
} from './webhooks-quality'
import type { InboundMessage, LogFn } from '@/domain/ports/whatsapp-webhooks'

export { extractQualityEvent }
export type { QualityWebhookEntry, InboundMessage, LogFn }
export type KapsoMessage = InboundMessage

export function parseKapsoWebhook(
  body: unknown,
  headers?: Record<string, string | undefined>,
  log?: LogFn
): InboundMessage | null {
  return getWebhookProvider().parse(body, headers, log)
}

export function verifyKapsoSignature(
  body: string,
  signature: string,
  secret: string
): boolean {
  return getWebhookProvider().verifySignature(body, signature, secret)
}

export type WebhookKind = 'inbound' | 'status' | 'quality' | 'other'

/**
 * Pure dispatch discriminator. Status/inbound take precedence over quality
 * so a payload with mixed signals is not silently downgraded. Quality
 * helpers live in webhooks-quality.ts (WAQ-006).
 */
export function classifyWebhookKind(body: unknown): WebhookKind {
  if (!body || typeof body !== 'object') return 'other'
  const obj = body as Record<string, unknown>
  if (hasMetaStatuses(obj) || hasKapsoFlatStatus(obj)) return 'status'
  if (hasMetaMessages(obj) || hasKapsoFlatMessage(obj)) return 'inbound'
  if (hasMetaQuality(obj) || hasKapsoFlatQuality(obj)) return 'quality'
  return 'other'
}

interface NormalizedStatus {
  id: string
  status: string
  timestamp?: string
  recipientId?: string
  errors?: Array<Record<string, unknown>>
  raw: Record<string, unknown>
}

/**
 * Returns the status updates inside a webhook payload. Handles both Meta
 * envelope and Kapso flat shapes. Always returns an array; an empty result
 * means "no status updates here".
 *
 * Defensive: missing `id` entries are dropped (idempotency keys require an
 * id). The full original entry is preserved on the `raw` field for forensic
 * persistence in `whatsapp_messages.raw_status_payload`.
 */
export function normalizeStatusPayload(body: unknown): NormalizedStatus[] {
  if (!body || typeof body !== 'object') return []

  const fromMeta = extractMetaStatuses(body)
  if (fromMeta.length > 0) return fromMeta

  const fromKapso = extractKapsoFlatStatus(body as Record<string, unknown>)
  return fromKapso ? [fromKapso] : []
}

function hasMetaStatuses(obj: Record<string, unknown>): boolean {
  const value = firstChangeValue(obj)
  return Array.isArray(value?.statuses) && (value!.statuses as unknown[]).length > 0
}

function hasMetaMessages(obj: Record<string, unknown>): boolean {
  const value = firstChangeValue(obj)
  return Array.isArray(value?.messages) && (value!.messages as unknown[]).length > 0
}

function hasKapsoFlatStatus(obj: Record<string, unknown>): boolean {
  if (obj.message_status && typeof obj.message_status === 'object') return true
  if (obj.event === 'message_status') return true
  return false
}

function hasKapsoFlatMessage(obj: Record<string, unknown>): boolean {
  return Boolean(obj.message && typeof obj.message === 'object')
}

function firstChangeValue(
  obj: Record<string, unknown>
): Record<string, unknown> | null {
  const entries = Array.isArray(obj.entry) ? obj.entry : []
  const entry = entries[0] as Record<string, unknown> | undefined
  const changes = Array.isArray(entry?.changes) ? entry!.changes : []
  const change = changes[0] as Record<string, unknown> | undefined
  const value = change?.value
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : null
}

function extractMetaStatuses(body: unknown): NormalizedStatus[] {
  try {
    const normalized = normalizeWebhook(body)
    return normalized.statuses
      .map(toNormalizedStatus)
      .filter((s): s is NormalizedStatus => s !== null)
  } catch {
    return []
  }
}

function extractKapsoFlatStatus(
  obj: Record<string, unknown>
): NormalizedStatus | null {
  const candidate =
    (obj.message_status as Record<string, unknown> | undefined) ??
    (obj.event === 'message_status'
      ? (obj.data as Record<string, unknown> | undefined)
      : undefined)
  return candidate ? toNormalizedStatus(candidate) : null
}

function toNormalizedStatus(
  raw: Record<string, unknown>
): NormalizedStatus | null {
  const id = typeof raw.id === 'string' ? raw.id : null
  const status = typeof raw.status === 'string' ? raw.status : null
  if (!id || !status) return null
  return {
    id,
    status,
    timestamp: readString(raw.timestamp),
    recipientId: readString(raw.recipientId) ?? readString(raw.recipient_id),
    errors: Array.isArray(raw.errors)
      ? (raw.errors as Array<Record<string, unknown>>)
      : undefined,
    raw,
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}
