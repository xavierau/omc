// WONB-004: pure auto-grading function for the contact import wizard.
// Encodes the Q-B decision table verbatim. Any change here must update
// docs/tasks/wonb-004-plan.md and the parametric test in lock-step.

import type { ConsentChannel } from '@/domain/value-objects/consent-channel'
import type { ConsentGrade } from '@/domain/value-objects/consent-status'

const MS_PER_MONTH = (365.25 / 12) * 24 * 60 * 60 * 1000

export interface GradeConsentInput {
  channel: ConsentChannel
  consentTextShown: string
  dateRangeEnd: Date
  now: Date
}

export function gradeConsent(input: GradeConsentInput): ConsentGrade {
  if (input.channel === 'none') return 'none'
  if (input.channel === 'service_only') return 'weak'

  const ageMs = input.now.getTime() - input.dateRangeEnd.getTime()
  const within12 = ageMs <= 12 * MS_PER_MONTH
  const within24 = ageMs <= 24 * MS_PER_MONTH
  if (!within24) return 'none'

  if (input.channel === 'whatsapp') return gradeWhatsapp(within12, input.consentTextShown)
  return within12 ? 'medium' : 'weak'
}

function gradeWhatsapp(within12: boolean, text: string): ConsentGrade {
  const mentionsWa = /whatsapp/i.test(text)
  if (within12 && mentionsWa) return 'strong'
  return 'medium'
}
