import { describe, it, expect } from 'vitest'
import { settingsErrorMessageKey } from '@/components/dashboard/integrations/settings-error-messages'

// Every code the settings PATCH (400 validators + 422 business rules), the
// outbound-secret PUT, and the outbound/test POST can return — each maps to
// its own key so the cards never render a blank message (dispatch: "each
// 422 code renders its message", generalized to the 400 codes too since a
// single client function surfaces both under one type).
describe('settingsErrorMessageKey', () => {
  it.each([
    ['unknown_field', 'errorUnknownField'],
    ['invalid_body', 'errorGeneric'],
    ['invalid_new_join_template_id', 'errorInvalidTemplateId'],
    ['invalid_consent_attestation_text', 'errorInvalidAttestationText'],
    ['invalid_consent_attestation_ack', 'errorInvalidAttestationAck'],
    ['invalid_outbound_url', 'errorUrlInvalid'],
    ['invalid_outbound_events', 'errorInvalidEvents'],
    ['invalid_outbound_enabled', 'errorInvalidEnabled'],
    ['invalid_outbound_pii_ack', 'errorInvalidPiiAck'],
    ['template_not_found', 'errorTemplateNotFound'],
    ['template_not_approved', 'errorTemplateNotApproved'],
    ['template_not_owned', 'errorTemplateNotOwned'],
    ['no_default_welcome_template', 'errorNoDefaultTemplate'],
    ['url_not_https', 'errorUrlNotHttps'],
    ['url_private_address', 'errorUrlPrivateAddress'],
    ['url_invalid', 'errorUrlInvalid'],
    ['url_port', 'errorUrlPort'],
    ['url_userinfo', 'errorUrlUserinfo'],
    ['pii_ack_required', 'errorPiiAckRequired'],
    ['secret_too_short', 'errorSecretTooShort'],
    ['url_not_saved', 'errorTestUrlNotSaved'],
    ['not_eligible_for_delivery', 'errorTestNotEligible'],
    ['integration_not_found', 'errorIntegrationNotFound'],
    ['network_error', 'errorGeneric'],
  ])('maps %s -> %s', (code, key) => {
    expect(settingsErrorMessageKey(code)).toBe(key)
  })

  it('falls back to errorGeneric for an unrecognized code (never renders blank)', () => {
    expect(settingsErrorMessageKey('some_future_code_this_test_never_named')).toBe('errorGeneric')
    expect(settingsErrorMessageKey('')).toBe('errorGeneric')
  })
})
