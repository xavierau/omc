/**
 * Kapso "payload v2" outbound status webhooks
 * (`whatsapp.message.sent/delivered/read/failed`, docs.kapso.ai/docs/platform/webhooks/message-events).
 *
 * Shape: `{ message: { id, timestamp, to, kapso: { direction: 'outbound',
 * status, statuses: [...] } } }`. Inbound v2 messages carry
 * `kapso.direction: 'inbound'` and no `statuses` — never treated as status
 * here (CAMP-008 / #131, plan D1).
 *
 * We return exactly ONE status entry per webhook (the current status), not
 * the full `statuses[]` history: replaying history would re-claim
 * `${id}:sent` idempotency keys on every later webhook for no gain, since
 * the status lattice already ignores regressions.
 */
export function hasKapsoV2OutboundStatus(obj: Record<string, unknown>): boolean {
  const kapso = readOutboundKapso(obj)
  if (!kapso) return false
  return hasStatusesArray(kapso) || typeof kapso.status === 'string'
}

/**
 * Returns the raw status entry to normalise, or null if this is not a v2
 * outbound status webhook. Selection: the `statuses[]` entry whose
 * `status === kapso.status` (last match wins), else the last `statuses[]`
 * entry, else a synthesised entry from `message.id` / `kapso.status` /
 * `message.timestamp` / `message.to`.
 */
export function extractKapsoV2Status(
  obj: Record<string, unknown>
): Record<string, unknown> | null {
  const kapso = readOutboundKapso(obj)
  if (!kapso) return null

  const currentStatus = typeof kapso.status === 'string' ? kapso.status : undefined

  if (hasStatusesArray(kapso)) {
    const statuses = kapso.statuses as Array<Record<string, unknown>>
    const matched = currentStatus
      ? findLast(statuses, (s) => s?.status === currentStatus)
      : undefined
    return matched ?? statuses[statuses.length - 1]
  }

  if (!currentStatus) return null

  const message = obj.message as Record<string, unknown>
  return {
    id: message.id,
    status: currentStatus,
    timestamp: message.timestamp,
    recipient_id: message.to,
  }
}

function readOutboundKapso(
  obj: Record<string, unknown>
): Record<string, unknown> | null {
  const message = obj.message
  if (!message || typeof message !== 'object') return null
  const kapso = (message as Record<string, unknown>).kapso
  if (!kapso || typeof kapso !== 'object') return null
  const kapsoObj = kapso as Record<string, unknown>
  return kapsoObj.direction === 'outbound' ? kapsoObj : null
}

function hasStatusesArray(kapso: Record<string, unknown>): boolean {
  return Array.isArray(kapso.statuses) && (kapso.statuses as unknown[]).length > 0
}

function findLast<T>(items: T[], predicate: (item: T) => boolean): T | undefined {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    if (predicate(items[i])) return items[i]
  }
  return undefined
}
