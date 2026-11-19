-- AGENT-001: AI reply agent (POC). Plan: .claude-workspace/plans/2026-11-19-agent-001-ai-reply-agent.md;
-- threats: threats/2026-11-19-agent-001-ai-reply-agent.md (R1-R11).
--
-- Every new table is service-role only: RLS on, no policies (same posture as
-- 082 booking tables, R7). The webhook and the worker write through the server;
-- W2's dashboard reads through API routes scoped by getTenantContext().

-- ---------------------------------------------------------------------------
-- 1. Per-restaurant agent settings.
--
-- Read by its own getter (agent-config-repository.ts), never through
-- RESTAURANT_COLUMNS. NOT NULL DEFAULT backfills every existing row to mode
-- off; every other knob is resolved, clamped and defaulted in the domain
-- (agent-config.ts), so the column only pins the mode vocabulary.
ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS agent_config JSONB NOT NULL DEFAULT '{"mode":"off"}'::jsonb;

UPDATE restaurants SET agent_config = '{"mode":"off"}'::jsonb WHERE agent_config IS NULL;

ALTER TABLE restaurants
  ADD CONSTRAINT restaurants_agent_config_mode_check
  CHECK (
    jsonb_typeof(agent_config) = 'object'
    AND coalesce(agent_config->>'mode', 'off') IN ('off', 'shadow', 'auto')
  );

-- ---------------------------------------------------------------------------
-- 2. Conversation turns (R5, R9).
--
-- A `user` row is the diner's text (stored to answer it, purged after the
-- tenant's historyTtlHours, default 72 h: R5). A `model` row records one
-- agent run: its outcome, the reply text (null when there was none), the
-- model id, latency and the tool names called (names only, never args: R9).
-- `phone` is E.164 with leading '+', as booking_tokens.phone.
CREATE TABLE agent_messages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  phone         TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('user', 'model')),
  text          TEXT,
  wamid         TEXT,
  outcome       TEXT CHECK (outcome IN ('shadow_draft', 'sent', 'fallback', 'error', 'rate_limited', 'skipped')),
  model         TEXT,
  latency_ms    INT CHECK (latency_ms IS NULL OR latency_ms >= 0),
  tool_calls    TEXT[] NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT agent_messages_role_shape CHECK (
    (role = 'user' AND text IS NOT NULL AND outcome IS NULL)
    OR (role = 'model' AND outcome IS NOT NULL AND wamid IS NULL)
  )
);

-- A webhook retry of the same inbound is a 23505 -> no second job.
CREATE UNIQUE INDEX agent_messages_restaurant_wamid_key
  ON agent_messages (restaurant_id, wamid) WHERE wamid IS NOT NULL;

-- History, latest-wins and the per-phone limit read one conversation newest first.
CREATE INDEX agent_messages_conversation_idx
  ON agent_messages (restaurant_id, phone, created_at DESC);

-- The per-tenant daily cap and the retention purge scan one tenant by time.
CREATE INDEX agent_messages_restaurant_created_idx
  ON agent_messages (restaurant_id, created_at);

ALTER TABLE agent_messages ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 3. Handoff silences (OR4).
--
-- `handoff_to_staff` silences the agent for one diner for handoffSilenceHours.
-- Its own table, not a conversation_windows column: a window row is per
-- 24 h service window (a new one is inserted when it expires) and has a sole
-- writer (WAQ-008), so a silence stored there would be lost on the next window.
CREATE TABLE agent_silences (
  restaurant_id  UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  phone          TEXT NOT NULL,
  silenced_until TIMESTAMPTZ NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (restaurant_id, phone)
);

CREATE INDEX agent_silences_until_idx ON agent_silences (silenced_until);

ALTER TABLE agent_silences ENABLE ROW LEVEL SECURITY;
