// INT-001 WI-8: PATCH allowlist + per-field shape validation for
// `integration_settings` (T-M5's new routes; same hand-rolled-allowlist
// pattern as WI-0's `integration-validators.ts` -- repo has no zod, R12).
// Business-rule validation (template ownership/approval, URL SSRF safety,
// the outbound_enabled invariant) is NOT done here -- this layer only
// enforces field allowlisting + primitive shape, matching WI-0's own
// division of labour (route-level allowlist vs application-level rules).

const ALLOWED_SETTINGS_FIELDS = [
  'newJoinTemplateId',
  'consentAttestationText',
  'consentAttestationAck',
  'outboundUrl',
  'outboundEvents',
  'outboundEnabled',
  'outboundPiiAck',
] as const
type AllowedSettingsField = (typeof ALLOWED_SETTINGS_FIELDS)[number]

export type OutboundEventName = 'member.created' | 'member.updated'
const ALLOWED_OUTBOUND_EVENTS: readonly OutboundEventName[] = ['member.created', 'member.updated']

const NEW_JOIN_TEMPLATE_UUID = /^[0-9a-f-]{36}$/i

export interface ParsedSettingsPatch {
  newJoinTemplateId?: string | null
  consentAttestationText?: string | null
  consentAttestationAck?: boolean
  outboundUrl?: string
  outboundEvents?: OutboundEventName[]
  outboundEnabled?: boolean
  outboundPiiAck?: boolean
}

export type SettingsPatchResult =
  | { ok: true; data: ParsedSettingsPatch }
  | { ok: false; error: 'unknown_field'; field: string }
  | {
      ok: false
      error:
        | 'invalid_body'
        | 'invalid_new_join_template_id'
        | 'invalid_consent_attestation_text'
        | 'invalid_consent_attestation_ack'
        | 'invalid_outbound_url'
        | 'invalid_outbound_events'
        | 'invalid_outbound_enabled'
        | 'invalid_outbound_pii_ack'
    }

function isAllowedField(key: string): key is AllowedSettingsField {
  return (ALLOWED_SETTINGS_FIELDS as readonly string[]).includes(key)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseSettingsPatch(body: unknown): SettingsPatchResult {
  if (!isPlainObject(body)) {
    return { ok: false, error: 'invalid_body' }
  }

  for (const key of Object.keys(body)) {
    if (!isAllowedField(key)) {
      return { ok: false, error: 'unknown_field', field: key }
    }
  }

  const data: ParsedSettingsPatch = {}

  if ('newJoinTemplateId' in body) {
    const value = body.newJoinTemplateId
    if (value !== null && typeof value !== 'string') {
      return { ok: false, error: 'invalid_new_join_template_id' }
    }
    if (typeof value === 'string' && value !== 'default' && !NEW_JOIN_TEMPLATE_UUID.test(value)) {
      return { ok: false, error: 'invalid_new_join_template_id' }
    }
    data.newJoinTemplateId = value
  }

  if ('consentAttestationText' in body) {
    const value = body.consentAttestationText
    if (value !== null && typeof value !== 'string') {
      return { ok: false, error: 'invalid_consent_attestation_text' }
    }
    data.consentAttestationText = value
  }

  if ('consentAttestationAck' in body) {
    if (typeof body.consentAttestationAck !== 'boolean') {
      return { ok: false, error: 'invalid_consent_attestation_ack' }
    }
    data.consentAttestationAck = body.consentAttestationAck
  }

  if ('outboundUrl' in body) {
    if (typeof body.outboundUrl !== 'string' || body.outboundUrl.trim().length === 0) {
      return { ok: false, error: 'invalid_outbound_url' }
    }
    data.outboundUrl = body.outboundUrl
  }

  if ('outboundEvents' in body) {
    const value = body.outboundEvents
    if (
      !Array.isArray(value) ||
      !value.every((entry): entry is OutboundEventName => ALLOWED_OUTBOUND_EVENTS.includes(entry as OutboundEventName))
    ) {
      return { ok: false, error: 'invalid_outbound_events' }
    }
    data.outboundEvents = value
  }

  if ('outboundEnabled' in body) {
    if (typeof body.outboundEnabled !== 'boolean') {
      return { ok: false, error: 'invalid_outbound_enabled' }
    }
    data.outboundEnabled = body.outboundEnabled
  }

  if ('outboundPiiAck' in body) {
    if (typeof body.outboundPiiAck !== 'boolean') {
      return { ok: false, error: 'invalid_outbound_pii_ack' }
    }
    data.outboundPiiAck = body.outboundPiiAck
  }

  return { ok: true, data }
}

/** Shared by `set-outbound-secret.ts` (US-9, T-H1: OD-9 partner-minted
 * secret pasted by the owner) -- spec: "empty secret, or shorter than 16
 * characters, is rejected inline; nothing is persisted." */
export function isValidOutboundSecret(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 16
}
