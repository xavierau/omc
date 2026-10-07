-- MEM-004: allow the 'reachability_restored' event type, recorded when an
-- inbound message clears members.unreachable_at (Meta 131026 is not permanent).
-- Copies the full 050 list (authoritative current set, 19 types) + 1 new = 20.
-- Must stay equal to the EventType union in src/domain/entities/event.ts.
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_type_check;
ALTER TABLE events ADD CONSTRAINT events_type_check
  CHECK (type IN (
    'join','redeem','receipt','campaign','points',
    'unsubscribe','reward_redeem',
    'pos_transaction','pos_refund','pos_customer_link',
    'integration_error','whatsapp_error',
    'onboarding_phase_advanced',
    'consent_imported','consent_granted',
    'consent_revoked','consent_expired',
    'stamp','stamp_reversal',
    'reachability_restored'                                       -- NEW (081)
  ));
