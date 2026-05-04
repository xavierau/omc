import type { StatusUpdate } from '@/domain/entities/whatsapp-message'
import type { MessageStatus } from '@/domain/value-objects/message-status'

/**
 * A normalised, defensively-shaped Kapso status entry. The Meta envelope
 * normaliser camelCases keys; Kapso flat shapes stay snake_case. Both cases
 * are handled by the readers below.
 */
export interface KapsoStatusEntry {
  id: string
  status: string
  timestamp?: string
  recipientId?: string
  errors?: Array<Record<string, unknown>>
  raw: Record<string, unknown>
}

const KNOWN_STATUSES = new Set<MessageStatus>([
  'queued',
  'sent',
  'delivered',
  'read',
  'failed',
])

/**
 * Translates a transport-shaped Kapso status entry into a domain
 * `StatusUpdate`. Defensive on every field — the SDK declares
 * `errors: Array<Record<string, unknown>>` and the inner shape is
 * documented but unconfirmed by Kapso.
 */
export function mapStatusUpdate(status: KapsoStatusEntry): StatusUpdate {
  return {
    status: coerceStatus(status.status),
    timestamp: parseTimestamp(status.timestamp),
    errorCode: extractErrorCode(status.errors),
    errorTitle: extractErrorTitle(status.errors),
    errorDetails: extractErrorDetails(status.errors),
  }
}

function coerceStatus(raw: string): MessageStatus {
  return KNOWN_STATUSES.has(raw as MessageStatus)
    ? (raw as MessageStatus)
    : 'failed'
}

function parseTimestamp(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  if (raw.includes('T') || raw.includes('-')) return raw
  const asInt = Number.parseInt(raw, 10)
  if (Number.isNaN(asInt)) return undefined
  return new Date(asInt * 1000).toISOString()
}

function extractErrorCode(
  errors: Array<Record<string, unknown>> | undefined
): string | null {
  const code = errors?.[0]?.code
  if (code === undefined || code === null) return null
  return String(code)
}

function extractErrorTitle(
  errors: Array<Record<string, unknown>> | undefined
): string | null {
  const title = errors?.[0]?.title
  return typeof title === 'string' ? title : null
}

function extractErrorDetails(
  errors: Array<Record<string, unknown>> | undefined
): string | null {
  // Meta envelope normaliser camelCases `error_data` -> `errorData`;
  // Kapso flat payloads stay snake_case. Read both.
  const first = errors?.[0]
  const errorData =
    (first?.errorData as Record<string, unknown> | undefined) ??
    (first?.error_data as Record<string, unknown> | undefined)
  const details = errorData?.details
  return typeof details === 'string' ? details : null
}
