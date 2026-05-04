// WAQ-004: consent classification primitives.
// `category` partitions consent by template message class (marketing /
// utility / authentication). `status` is the lifecycle bit. `grade` records
// audit strength: 'strong' for first-party captured consents, 'weak' for
// backfilled / pre-system migration records that WONB-008 will upgrade via
// a re-confirmation campaign.

export type ConsentStatus = 'opted_in' | 'opted_out' | 'pending'
export type ConsentCategory = 'marketing' | 'utility' | 'authentication'
export type ConsentGrade = 'strong' | 'weak'

const STATUSES: readonly ConsentStatus[] = ['opted_in', 'opted_out', 'pending']
const CATEGORIES: readonly ConsentCategory[] = [
  'marketing',
  'utility',
  'authentication',
]
const GRADES: readonly ConsentGrade[] = ['strong', 'weak']

export function isConsentStatus(v: unknown): v is ConsentStatus {
  return typeof v === 'string' && (STATUSES as readonly string[]).includes(v)
}

export function isConsentCategory(v: unknown): v is ConsentCategory {
  return typeof v === 'string' && (CATEGORIES as readonly string[]).includes(v)
}

export function isConsentGrade(v: unknown): v is ConsentGrade {
  return typeof v === 'string' && (GRADES as readonly string[]).includes(v)
}
