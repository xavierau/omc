-- WAQ-008: tracks open WhatsApp 24h customer service windows.
--
-- Upserted on every inbound message; readers use isInWindow() to decide
-- service-message vs template-message routing. expires_at = now + 24h on
-- every inbound; the row is preserved past expiry for analytics history,
-- only marked logically closed by the timestamp comparison
-- (`expires_at > now()` => still open).
--
-- One ACTIVE row per (restaurant_id, phone_e164) is enforced at the
-- application layer via UPSERT semantics (find-then-bump-or-insert in
-- the repository). A partial unique index `WHERE expires_at > now()`
-- is not valid in Postgres (NOW() is volatile), so we rely on a regular
-- unique index over (restaurant_id, phone_e164, opened_at) for the
-- INSERT path and let the read query filter by `expires_at > now()`.
--
-- Closed/expired rows accumulate as conversation history. Cleanup is a
-- separate ops follow-up (analogous to WAQ-OPS-001) — NOT shipped here.
--
-- Writer: SOLE writer is the service-role client at
--   src/infrastructure/supabase/repositories/conversation-window-repository.ts
-- which bypasses RLS. The SELECT policy below is for tenant dashboards
-- and platform-admin read access only — there are intentionally no
-- INSERT/UPDATE policies (browser-side writes are not supported).

CREATE TABLE conversation_windows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  phone_e164 TEXT NOT NULL,
  -- First-message-of-window timestamp. Stable for the lifetime of the
  -- window; when an inbound bumps an existing open row, opened_at stays
  -- the same and only last_inbound_at + expires_at advance.
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Bumped on every inbound while the window is still open.
  last_inbound_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 24h from the most recent inbound. `expires_at > now()` => open.
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '24 hours'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Insert-side uniqueness: prevents two rows for the same (rid, phone)
-- with the same opened_at. The repo never re-inserts a row with an
-- existing opened_at — it bumps the existing one.
CREATE UNIQUE INDEX idx_conversation_windows_rid_phone_opened
  ON conversation_windows(restaurant_id, phone_e164, opened_at);

-- Read-side hot path: `findOpen` for a (rid, phone) pair.
CREATE INDEX idx_conversation_windows_rid_phone_expires
  ON conversation_windows(restaurant_id, phone_e164, expires_at DESC);

-- Tenant analytics rollup: count active conversations per restaurant.
CREATE INDEX idx_conversation_windows_rid_expires
  ON conversation_windows(restaurant_id, expires_at DESC);

-- Reuses update_updated_at_column() defined in migration 035.
CREATE TRIGGER set_conversation_windows_updated_at
  BEFORE UPDATE ON conversation_windows
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS — SELECT-only (writes are service-role-bypassed; see top-of-file).
ALTER TABLE conversation_windows ENABLE ROW LEVEL SECURITY;

CREATE POLICY conversation_windows_select ON conversation_windows
  FOR SELECT USING (
    restaurant_id IN (SELECT user_restaurant_ids()) OR is_platform_admin()
  );
