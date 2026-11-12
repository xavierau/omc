// INT-001: the partner's single asserted consent level, mapped onto the
// per-category (marketing/utility) consent_records rows it may write.

import type { ConsentCategory, ConsentStatus } from './consent-status'

export type ConsentLevel = 'none' | 'utility' | 'all'

const LEVELS: readonly ConsentLevel[] = ['none', 'utility', 'all']

export function isConsentLevel(value: unknown): value is ConsentLevel {
  return typeof value === 'string' && (LEVELS as readonly string[]).includes(value)
}

// Only 'marketing' and 'utility' are asserted by the partner API; the
// platform never asks a partner to assert 'authentication' consent.
export type PartnerConsentCategory = Extract<ConsentCategory, 'marketing' | 'utility'>

/** The consent level required for the given category to be permitted. */
export function requiredLevelFor(category: PartnerConsentCategory): ConsentLevel {
  return category === 'marketing' ? 'all' : 'utility'
}

/** Whether `level` covers `category` (i.e. is at least the required level). */
export function covers(level: ConsentLevel, category: PartnerConsentCategory): boolean {
  const required = requiredLevelFor(category)
  if (required === 'utility') return level === 'utility' || level === 'all'
  return level === 'all'
}

/** Alias kept for readability at call sites that read as "is X permitted". */
export function permits(level: ConsentLevel, category: PartnerConsentCategory): boolean {
  return covers(level, category)
}

/**
 * Derives the member's overall effective level from the latest status of
 * each category: 'all' when both are opted_in, 'utility' when only utility
 * is opted_in, otherwise 'none'.
 */
export function effectiveLevel(
  utilityStatus: ConsentStatus | null,
  marketingStatus: ConsentStatus | null
): ConsentLevel {
  const utilityIn = utilityStatus === 'opted_in'
  const marketingIn = marketingStatus === 'opted_in'
  if (utilityIn && marketingIn) return 'all'
  if (utilityIn) return 'utility'
  return 'none'
}
