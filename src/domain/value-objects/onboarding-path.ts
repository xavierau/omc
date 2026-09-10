// WONB-001: tenant onboarding path. Path A is the canonical "fresh HK SIM
// never used for WhatsApp" route. Paths B1/B2/B3 are coexistence variants
// where the tenant arrives with an existing WhatsApp footprint and
// `hk_sim_never_used` is auto-N/A in the pre-kickoff checklist.

export type OnboardingPath = 'A' | 'B1' | 'B2' | 'B3'

export const ONBOARDING_PATHS: readonly OnboardingPath[] = Object.freeze([
  'A',
  'B1',
  'B2',
  'B3',
])

export function isOnboardingPath(value: unknown): value is OnboardingPath {
  return (
    typeof value === 'string' &&
    (ONBOARDING_PATHS as readonly string[]).includes(value)
  )
}
