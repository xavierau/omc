/**
 * TAG-001 F1 — pure client-side merge-checkbox semantics (AD-4). Turns the
 * raw phone sets the server returns (B5's `PreviewLookups`) into per-row
 * verdicts, so toggling the merge checkbox on the preview step is a local
 * recompute with zero network requests (A17).
 *
 * Precedence is AM-4, mirroring `resolveMemberId`'s real commit-time ordering
 * exactly (see the plan's "Amendments" section and B5's orchestrator
 * correction) — NOT the earlier "active consent always wins" draft:
 *   merge OFF: already-a-member wins regardless of consent (`tryInsertMember`
 *              fails first) → phone_already_member; else active consent →
 *              duplicate_active.
 *   merge ON:  active consent wins regardless of membership (the merge path
 *              finds the member, then the consent insert decides) →
 *              duplicate_active; else already-a-member → merged.
 */
import type { PreviewLookups } from '@/hooks/use-import-batch'

export interface PreviewWarnings {
  willMerge: number
  willSkipAlreadyMember: number
  willSkipActiveConsent: number
  warnedPhones: Set<string>
}

interface BuildPreviewWarningsInput {
  rows: Array<{ phoneE164: string }>
  lookups: PreviewLookups
  merge: boolean
}

export function buildPreviewWarnings({
  rows,
  lookups,
  merge,
}: BuildPreviewWarningsInput): PreviewWarnings {
  const alreadyMember = new Set(lookups.alreadyMemberPhones)
  const activeConsent = new Set(lookups.activeConsentPhones)

  let willMerge = 0
  let willSkipAlreadyMember = 0
  let willSkipActiveConsent = 0
  const warnedPhones = new Set<string>()

  for (const row of rows) {
    const phone = row.phoneE164
    const isMember = alreadyMember.has(phone)
    const hasConsent = activeConsent.has(phone)
    if (!isMember && !hasConsent) continue

    warnedPhones.add(phone)

    if (merge) {
      if (hasConsent) {
        willSkipActiveConsent++
      } else {
        willMerge++
      }
    } else {
      if (isMember) {
        willSkipAlreadyMember++
      } else {
        willSkipActiveConsent++
      }
    }
  }

  return { willMerge, willSkipAlreadyMember, willSkipActiveConsent, warnedPhones }
}
