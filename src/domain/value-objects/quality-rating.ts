// WAQ-006: per-tenant quality signal forwarded from Meta via Kapso.
// `QualityRating` is the four-state lattice GREEN > YELLOW > RED, with
// UNKNOWN as the "no Meta signal yet" sentinel. UNKNOWN never participates
// in degradation/recovery comparisons so a momentary signal gap cannot
// trigger a false positive in WAQ-009 auto-pause logic.
//
// `MessagingTier` is opaque on purpose. Meta has shipped TIER_1K, TIER_10K,
// TIER_100K, TIER_UNLIMITED, TIER_NOT_SET, and others over time; treating
// the field as a free-form string lets a new tier name flow through without
// a code change. The four canonical names are exported as a union for
// authoring convenience only.

export type QualityRating = 'GREEN' | 'YELLOW' | 'RED' | 'UNKNOWN'
export type MessagingTier =
  | 'TIER_1K'
  | 'TIER_10K'
  | 'TIER_100K'
  | 'TIER_UNLIMITED'
  | string

const RATINGS: readonly QualityRating[] = ['GREEN', 'YELLOW', 'RED', 'UNKNOWN']
const ORDER: Record<Exclude<QualityRating, 'UNKNOWN'>, number> = {
  GREEN: 0,
  YELLOW: 1,
  RED: 2,
}

export function isQualityRating(v: unknown): v is QualityRating {
  return typeof v === 'string' && (RATINGS as readonly string[]).includes(v)
}

export function isMessagingTier(v: unknown): v is MessagingTier {
  return typeof v === 'string' && v.length > 0
}

/** GREEN -> YELLOW or YELLOW -> RED. UNKNOWN never participates. */
export function isDegradation(from: QualityRating, to: QualityRating): boolean {
  if (from === 'UNKNOWN' || to === 'UNKNOWN') return false
  return ORDER[to] > ORDER[from]
}

/** YELLOW -> GREEN or RED -> YELLOW/GREEN. UNKNOWN never participates. */
export function isRecovery(from: QualityRating, to: QualityRating): boolean {
  if (from === 'UNKNOWN' || to === 'UNKNOWN') return false
  return ORDER[to] < ORDER[from]
}
