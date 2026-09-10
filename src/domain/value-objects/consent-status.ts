// WAQ-004 / WONB-005: consent classification primitives.
// `category` partitions consent by template message class (marketing /
// utility / authentication). `status` is the lifecycle bit. `grade` records
// audit strength on a 4-level scale (WONB-005):
//   strong — first-party captured proof (paper form, signed waiver, web form)
//   medium — first-party low-friction (whatsapp_join_keyword, QR opt-in)
//   weak   — backfilled / pre-system migration records
//   none   — explicit no-marketing-consent marker (e.g. service_only)

export type ConsentStatus = 'opted_in' | 'opted_out' | 'pending'
export type ConsentCategory = 'marketing' | 'utility' | 'authentication'
export type ConsentGrade = 'strong' | 'medium' | 'weak' | 'none'

const STATUSES: readonly ConsentStatus[] = ['opted_in', 'opted_out', 'pending']
const CATEGORIES: readonly ConsentCategory[] = [
  'marketing',
  'utility',
  'authentication',
]
export const GRADES: readonly ConsentGrade[] = [
  'strong',
  'medium',
  'weak',
  'none',
]

export function isConsentStatus(v: unknown): v is ConsentStatus {
  return typeof v === 'string' && (STATUSES as readonly string[]).includes(v)
}

export function isConsentCategory(v: unknown): v is ConsentCategory {
  return typeof v === 'string' && (CATEGORIES as readonly string[]).includes(v)
}

export function isConsentGrade(v: unknown): v is ConsentGrade {
  return typeof v === 'string' && (GRADES as readonly string[]).includes(v)
}
