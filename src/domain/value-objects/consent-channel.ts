// WONB-004: per-batch consent channel for the contact import wizard.
// Determines auto-grading thresholds in `gradeConsent` and gates the
// `proof_url` requirement at the entity layer.
//   whatsapp     — collected via WhatsApp opt-in flow; proof required
//   generic      — collected via paper / web form / waiver
//   service_only — utility templates allowed, never marketing (always weak)
//   none         — explicit no-marketing-consent marker (always grade=none)

export type ConsentChannel =
  | 'whatsapp'
  | 'generic'
  | 'service_only'
  | 'none'

export const CONSENT_CHANNELS: readonly ConsentChannel[] = Object.freeze([
  'whatsapp',
  'generic',
  'service_only',
  'none',
])

export function isConsentChannel(value: unknown): value is ConsentChannel {
  return (
    typeof value === 'string' &&
    (CONSENT_CHANNELS as readonly string[]).includes(value)
  )
}
