/**
 * TAG-001 F2 / #139.3 — pure helpers for the post-commit rejected-rows list:
 * grouping by reason, and rendering the group as clipboard text or a CSV
 * download. `ImportRowReject.reason` is a closed 4-value union today
 * (`@/hooks/use-import-batch`); the fixed order below covers all four, and
 * any reason outside it (should the union ever grow) sorts alphabetically
 * after them rather than being dropped.
 */
import type { ImportRowReject } from '@/hooks/use-import-batch'

export interface RejectionGroup {
  reason: string
  rows: ImportRowReject[]
}

const REASON_ORDER = [
  'invalid_phone',
  'duplicate_phone_in_batch',
  'phone_already_member',
  'duplicate_active',
] as const

export function groupRejectionsByReason(rejected: ImportRowReject[]): RejectionGroup[] {
  const byReason = new Map<string, ImportRowReject[]>()
  for (const row of rejected) {
    const rows = byReason.get(row.reason)
    if (rows) {
      rows.push(row)
    } else {
      byReason.set(row.reason, [row])
    }
  }

  const knownReasons = REASON_ORDER.filter((reason) => byReason.has(reason))
  const unknownReasons = [...byReason.keys()]
    .filter((reason) => !(REASON_ORDER as readonly string[]).includes(reason))
    .sort()

  return [...knownReasons, ...unknownReasons].map((reason) => ({
    reason,
    rows: byReason.get(reason) as ImportRowReject[],
  }))
}

function quoteCsvField(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

export function toRejectionsCsv(rejected: ImportRowReject[]): string {
  const header = ['phone', 'reason', 'message'].map(quoteCsvField).join(',')
  const rows = rejected.map((row) =>
    [row.phoneE164, row.reason, row.message ?? ''].map(quoteCsvField).join(',')
  )
  return [header, ...rows].join('\r\n')
}

export function toClipboardText(rejected: ImportRowReject[]): string {
  return rejected
    .map((row) => [row.phoneE164, row.reason, row.message ?? ''].join('\t'))
    .join('\n')
}
