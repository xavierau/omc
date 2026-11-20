// Stamp dedup-key builder (pure). The dedup_key is BOTH the idempotency guard
// and the per-day cap (one mechanism — see plan §2.C / §3). The DB RPC derives
// the date server-side in HK time and finds the lowest free `:N` slot; these
// pure helpers are the deterministic, testable formatting core. Inject the
// Date — never call now() here.

const HK_TIME_ZONE = 'Asia/Hong_Kong'

const hkDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: HK_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** Format an instant to its HK-local calendar day as `YYYY-MM-DD`. */
export function hkLocalDateString(at: Date): string {
  // en-CA renders ISO-like `YYYY-MM-DD`, so no manual part assembly is needed.
  return hkDateFormatter.format(at)
}

export interface StampDedupKeyInput {
  campaignId: string
  stampDate: string // HK-local YYYY-MM-DD (from hkLocalDateString)
  sequence?: number // in-day slot when max_stamps_per_day > 1
}

/** Build `campaignId:stampDate` (cap=1) or `campaignId:stampDate:N` (cap>1). */
export function buildStampDedupKey(input: StampDedupKeyInput): string {
  assertNonEmpty('campaignId', input.campaignId)
  assertNonEmpty('stampDate', input.stampDate)
  const base = `${input.campaignId}:${input.stampDate}`
  if (input.sequence === undefined) return base
  assertPositiveInt('sequence', input.sequence)
  return `${base}:${input.sequence}`
}

function assertNonEmpty(field: string, value: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`stamp-dedup-key: ${field} is required`)
  }
}

function assertPositiveInt(field: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`stamp-dedup-key: ${field} must be a positive integer`)
  }
}
