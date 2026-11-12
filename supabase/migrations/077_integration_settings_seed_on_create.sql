-- INT-001 WI-19 (D1 fix): 069's own backfill only seeded `integration_settings`
-- for `pos_integrations` rows that already existed AT MIGRATION TIME (0 on
-- prod). Nothing else ever created the row for an integration made
-- afterwards -- `configure-pos-integration.ts`'s `createIntegration` only
-- inserts into `pos_integrations`; the settings repository has find/update
-- only, no create. Prod smoke 2026-09-10: `GET .../settings` 404,
-- `PATCH .../settings` 422 `template_not_found` on a freshly-created
-- integration (release runbook D1).
--
-- Fix: an AFTER INSERT trigger on `pos_integrations`, mirroring the
-- INT-001 outbox trigger pattern already established in migration 071
-- (trg_integration_events_fanout, trg_member_updated_outbox, ...). A
-- trigger fires in the SAME transaction as the `pos_integrations` INSERT
-- it's attached to -- there is no window between "integration exists" and
-- "settings row exists" for a concurrent read to land in, which is the
-- "cannot race" property an app-level RPC would have to build by hand (and
-- a lazy insert-on-first-read cannot give at all: two concurrent first
-- reads would both see no row and both attempt to create one). This also
-- means EVERY current and future creation path gets the row for free --
-- nothing in configure-pos-integration.ts needed to change.
--
-- `ON CONFLICT (integration_id) DO NOTHING` makes the trigger (and the
-- backfill below) idempotent: a `pos_integrations` row that somehow already
-- has a settings row (shouldn't happen post-069, but costs nothing to
-- guard) is left untouched rather than erroring.

CREATE OR REPLACE FUNCTION pos_integration_seed_settings()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO integration_settings (integration_id, restaurant_id)
  VALUES (NEW.id, NEW.restaurant_id)
  ON CONFLICT (integration_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_pos_integration_seed_settings
  AFTER INSERT ON pos_integrations
  FOR EACH ROW EXECUTE FUNCTION pos_integration_seed_settings();

-- Backfill: any integration created between the 069 backfill and this
-- trigger going live (03:31Z prod deploy through now) that has no settings
-- row yet. Re-running this migration is a no-op the second time (ON
-- CONFLICT DO NOTHING against `integration_id`, the table's PRIMARY KEY).
INSERT INTO integration_settings (integration_id, restaurant_id)
SELECT id, restaurant_id FROM pos_integrations
ON CONFLICT (integration_id) DO NOTHING;
