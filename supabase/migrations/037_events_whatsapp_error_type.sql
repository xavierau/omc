-- WAQ-003: extend events.type CHECK to allow `whatsapp_error` rows so the
-- ops-alert dispatcher in `src/application/emit-ops-alert.ts` can record
-- block_template / engineering_alert / policy_violation_alert entries.
--
-- The previous extension lives in 020_pos_integration.sql and 021_event_dispatch.sql.
-- We mirror that pattern: drop + re-create the constraint with the union of
-- previously allowed values plus `whatsapp_error`.

ALTER TABLE events DROP CONSTRAINT IF EXISTS events_type_check;
ALTER TABLE events ADD CONSTRAINT events_type_check
  CHECK (type IN (
    'join', 'redeem', 'receipt', 'campaign', 'points',
    'unsubscribe', 'reward_redeem',
    'pos_transaction', 'pos_refund', 'pos_customer_link',
    'integration_error',
    'whatsapp_error'
  ));
