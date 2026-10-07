// WAQ-009 round-1 review (CRITICAL): the stale-event guard MUST compare
// against Meta's payload time, not server `now`. This helper extracts the
// authoritative event time from Meta / Kapso payloads.
//
// Read order (first match wins, called from webhooks-quality.ts):
//   1. entry[].time                            — Meta's authoritative envelope time
//   2. entry[].changes[].value.event_time      — phone_number_quality_update etc.
//   3. entry[].changes[].value.timestamp       — Kapso flat shape
//
// Numeric values are treated as seconds-since-epoch (Meta's convention).
// Numeric strings (Meta sometimes stringifies the int) are coerced
// identically. Otherwise the value is parsed as ISO. Returns `undefined`
// when nothing usable is present — the caller falls back to server `now`
// for the stale guard (best-effort: only true delayed delivery slips
// through; concurrent dispatches are still caught by server time).

export function readEventTimestamp(
  value: Record<string, unknown>,
  entryTime: unknown
): string | undefined {
  return (
    coerceTimestamp(entryTime) ??
    coerceTimestamp(value.event_time) ??
    coerceTimestamp(value.timestamp)
  )
}

function coerceTimestamp(raw: unknown): string | undefined {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return new Date(raw * 1000).toISOString()
  }
  if (typeof raw !== 'string' || raw.length === 0) return undefined
  // Numeric strings (Meta stringifies seconds-since-epoch).
  if (/^\d+$/.test(raw)) {
    const n = Number(raw)
    if (Number.isFinite(n)) return new Date(n * 1000).toISOString()
  }
  // Otherwise try ISO parse. Reject obviously bad values.
  const parsed = new Date(raw)
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString()
  return undefined
}
