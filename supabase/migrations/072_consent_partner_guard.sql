-- INT-001 WI-1 (T-C1): DB belt-and-braces for the opted_out-is-absorbing
-- invariant. The application-level guard lives in
-- applyPartnerAssertedConsent() (consent-record-repository.ts) and is the
-- primary defence; this trigger is the second layer in case a future
-- partner_api write path bypasses that function.
--
-- Scoped to source = 'partner_api' only: `idx_consent_active_uniq` stays
-- partial on (opted_in, pending) so the member's OWN WhatsApp re-opt-in path
-- (source = 'whatsapp_optin_keyword' etc.) is untouched and can still insert
-- a fresh row over an opted_out history — only the partner-asserted path is
-- blocked from resurrecting a STOP.

CREATE OR REPLACE FUNCTION consent_partner_guard()
RETURNS TRIGGER AS $$
DECLARE
  latest_status TEXT;
BEGIN
  IF NEW.source <> 'partner_api' THEN
    RETURN NEW;
  END IF;

  SELECT status INTO latest_status
  FROM consent_records
  WHERE restaurant_id = NEW.restaurant_id
    AND phone_e164 = NEW.phone_e164
    AND category = NEW.category
  ORDER BY captured_at DESC
  LIMIT 1;

  IF latest_status = 'opted_out' THEN
    RAISE EXCEPTION 'consent_opted_out_absorbing'
      USING DETAIL = format(
        'partner_api insert blocked: latest %s consent for this identity is opted_out',
        NEW.category
      );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_consent_partner_guard
  BEFORE INSERT ON consent_records
  FOR EACH ROW EXECUTE FUNCTION consent_partner_guard();
