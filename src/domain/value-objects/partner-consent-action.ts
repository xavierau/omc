// INT-001 T-C1 / OD-14: the four outcomes of applying a partner-asserted
// consent level against the latest consent_records row for one category.
// The decision function that produces this value lives in
// `src/domain/services/partner-consent-policy.ts`.

export type PartnerConsentAction = 'inserted' | 'upgraded' | 'noop' | 'blocked_opted_out'

const ACTIONS: readonly PartnerConsentAction[] = [
  'inserted',
  'upgraded',
  'noop',
  'blocked_opted_out',
]

export function isPartnerConsentAction(value: unknown): value is PartnerConsentAction {
  return typeof value === 'string' && (ACTIONS as readonly string[]).includes(value)
}
