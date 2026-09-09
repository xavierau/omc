// INT-001 WI-9 — pure error-code -> i18n-key mapping for every settings-route
// error surface (spec §8.1 "PATCH integration settings" row; the settings
// validators' 400 codes and update-integration-settings.ts's 422
// `SettingsErrorCode`s), plus the outbound-secret PUT's `secret_too_short`
// and the outbound/test POST's three outcomes. Kept out of the card
// components (TSX has no logic) and unit-testable without rendering
// anything — every code this WI's PATCH/PUT/POST routes can return maps to
// its own `integrations.*` key; anything unrecognized (a future backend
// code, or a thrown fetch surfaced as `network_error`) falls back to
// `errorGeneric` rather than rendering a blank message.

const KEY_BY_CODE: Record<string, string> = {
  // integration-settings-validators.ts (400, field/shape)
  unknown_field: 'errorUnknownField',
  invalid_body: 'errorGeneric',
  invalid_new_join_template_id: 'errorInvalidTemplateId',
  invalid_consent_attestation_text: 'errorInvalidAttestationText',
  invalid_consent_attestation_ack: 'errorInvalidAttestationAck',
  invalid_outbound_url: 'errorUrlInvalid',
  invalid_outbound_events: 'errorInvalidEvents',
  invalid_outbound_enabled: 'errorInvalidEnabled',
  invalid_outbound_pii_ack: 'errorInvalidPiiAck',
  // update-integration-settings.ts (422, business rules)
  template_not_found: 'errorTemplateNotFound',
  template_not_approved: 'errorTemplateNotApproved',
  template_not_owned: 'errorTemplateNotOwned',
  no_default_welcome_template: 'errorNoDefaultTemplate',
  url_not_https: 'errorUrlNotHttps',
  url_private_address: 'errorUrlPrivateAddress',
  url_invalid: 'errorUrlInvalid',
  url_port: 'errorUrlPort',
  url_userinfo: 'errorUrlUserinfo',
  pii_ack_required: 'errorPiiAckRequired',
  // set-outbound-secret.ts (422)
  secret_too_short: 'errorSecretTooShort',
  // send-test-event.ts (422/404, via outbound/test route)
  url_not_saved: 'errorTestUrlNotSaved',
  not_eligible_for_delivery: 'errorTestNotEligible',
  integration_not_found: 'errorIntegrationNotFound',
  // client-side
  network_error: 'errorGeneric',
}

/** Maps any settings/secret/test-event error code this WI's routes can
 * return (or any unrecognized string) to an `integrations.*` i18n key. */
export function settingsErrorMessageKey(code: string): string {
  return KEY_BY_CODE[code] ?? 'errorGeneric'
}
