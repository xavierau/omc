-- 050_stamp_collection.sql  (stamp-collection MVP — Phase A backend foundation)
--
-- Ships: stamp_campaigns + member_stamp_cards tables, members.loyalty_token
-- (+ backfill), the events.type CHECK rebuild (047 baseline 17 → 19 types),
-- events.actor_user_id + dedup_key, the uq_events_stamp_dedup partial unique
-- index (BOTH the double-scan idempotency guard AND the 1/day cap), and the
-- apply_stamp / reverse_stamp RPCs (server-derived HK-local date — never
-- client-supplied; mirrors adjust_member_points (022) FOR UPDATE discipline and
-- the SECURITY DEFINER + service_role lockdown of delete_member_cascade (033)).
--
-- pgcrypto note: migration 024 installs pgcrypto WITH SCHEMA extensions and
-- calls extensions.gen_random_bytes(...). We mirror that exact qualified call.

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ============================================================================
-- (A) Campaign table: one ACTIVE campaign per restaurant (DB-enforced).
-- ============================================================================
CREATE TABLE stamp_campaigns (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id    UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  name_zh          TEXT,
  stamps_required  INT  NOT NULL CHECK (stamps_required > 0),
  reward_id        UUID NOT NULL REFERENCES rewards(id),
  starts_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ends_at          TIMESTAMPTZ,                       -- null = runs until paused
  status           TEXT NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft','active','paused','ended')),
  max_stamps_per_day INT NOT NULL DEFAULT 1 CHECK (max_stamps_per_day >= 1),
  honor_until      TIMESTAMPTZ,                       -- set on end → 14d grace window
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_stamp_campaigns_restaurant ON stamp_campaigns(restaurant_id);
-- EXACTLY ONE active campaign per restaurant at the DB level:
CREATE UNIQUE INDEX uq_stamp_campaigns_one_active
  ON stamp_campaigns(restaurant_id) WHERE status = 'active';

CREATE TRIGGER set_stamp_campaigns_updated_at
  BEFORE UPDATE ON stamp_campaigns
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- (B) Per-member progress card with SNAPSHOTTED deal terms (campaign-edit safety).
-- ============================================================================
CREATE TABLE member_stamp_cards (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id     UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  member_id         UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  campaign_id       UUID NOT NULL REFERENCES stamp_campaigns(id) ON DELETE CASCADE,
  stamps_count      INT  NOT NULL DEFAULT 0 CHECK (stamps_count >= 0),
  stamps_required   INT  NOT NULL,        -- snapshot at card creation
  reward_id         UUID NOT NULL,        -- snapshot at card creation
  status            TEXT NOT NULL DEFAULT 'in_progress'
                      CHECK (status IN ('in_progress','completed')),
  nudge_sent_at     TIMESTAMPTZ,          -- "X to go" sent at most once per card
  completed_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- At most one IN-PROGRESS card per (member, campaign); completed cards are kept.
CREATE UNIQUE INDEX uq_member_stamp_card_inprogress
  ON member_stamp_cards(member_id, campaign_id) WHERE status = 'in_progress';
CREATE INDEX idx_member_stamp_cards_restaurant ON member_stamp_cards(restaurant_id);

CREATE TRIGGER set_member_stamp_cards_updated_at
  BEFORE UPDATE ON member_stamp_cards
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- (C) Enrollment-issued loyalty QR coverage (LOCKED #1a). MVP token = plaintext
-- random hex (NOT hashed — accepted residual risk R-TOKEN, plan §13).
-- ============================================================================
ALTER TABLE members ADD COLUMN loyalty_token TEXT;
CREATE UNIQUE INDEX uq_members_loyalty_token ON members(loyalty_token)
  WHERE loyalty_token IS NOT NULL;
UPDATE members SET loyalty_token = encode(extensions.gen_random_bytes(16), 'hex')
  WHERE loyalty_token IS NULL;

-- ============================================================================
-- (D) Ledger: rebuild events.type CHECK. *** MIRROR migration 047 (NOT 037) ***
-- Authoritative current set = 17 (matches src/domain/entities/event.ts). Add 2 → 19.
-- Reviewer gate: this list MUST equal the 17 in event.ts + the 2 new types.
-- ============================================================================
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_type_check;
ALTER TABLE events ADD CONSTRAINT events_type_check
  CHECK (type IN (
    'join','redeem','receipt','campaign','points',
    'unsubscribe','reward_redeem',
    'pos_transaction','pos_refund','pos_customer_link',
    'integration_error','whatsapp_error',
    'onboarding_phase_advanced',                                  -- 046 (MUST keep)
    'consent_imported','consent_granted',                         -- 047 (MUST keep)
    'consent_revoked','consent_expired',                          -- 047 (MUST keep)
    'stamp','stamp_reversal'                                      -- NEW (050)
  ));

-- ============================================================================
-- (E) Actor capture + dedup. events has NO actor column today.
-- ============================================================================
ALTER TABLE events ADD COLUMN actor_user_id UUID;     -- who granted (staff/owner)
ALTER TABLE events ADD COLUMN dedup_key     TEXT;     -- 1/day cap == this key

-- THE single mechanism that is BOTH the idempotency guard AND the 1/day cap:
-- a partial unique index on (restaurant_id, member_id, dedup_key) for 'stamp'
-- rows. dedup_key = campaign_id || ':' || <HK-local stamp_date> (date derived
-- SERVER-SIDE in apply_stamp, never client-supplied). Second scan same
-- member/campaign/day → ON CONFLICT DO NOTHING → no-op.
CREATE UNIQUE INDEX uq_events_stamp_dedup
  ON events(restaurant_id, member_id, dedup_key)
  WHERE type = 'stamp' AND dedup_key IS NOT NULL;

-- ============================================================================
-- (F) apply_stamp RPC — idempotent grant with server-derived HK-local date.
-- Mirrors adjust_member_points (022) FOR UPDATE discipline; SECURITY DEFINER +
-- service_role lockdown per delete_member_cascade (033).
-- ============================================================================
CREATE OR REPLACE FUNCTION apply_stamp(
  p_restaurant_id UUID,
  p_member_id     UUID,
  p_campaign_id   UUID,
  p_actor_user_id UUID,
  p_max_per_day   INT
) RETURNS TABLE (
  -- OUT columns are out_-prefixed so they never shadow events / member_stamp_cards
  -- column names referenced unqualified in the body (notably dedup_key inside the
  -- ON CONFLICT target — Postgres errors on that ambiguity). Application layer
  -- maps these exact field names from the RPC result row.
  out_outcome         TEXT,    -- 'stamped' | 'already_stamped_today'
  out_stamps_count    INT,
  out_stamps_required INT,
  out_card_id         UUID,
  out_completed       BOOLEAN,
  out_dedup_key       TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_card        member_stamp_cards%ROWTYPE;
  v_campaign    stamp_campaigns%ROWTYPE;
  v_stamp_date  DATE;
  v_base_key    TEXT;
  v_key         TEXT;
  v_seq         INT;
  v_inserted    BOOLEAN := FALSE;
  v_completed   BOOLEAN := FALSE;
BEGIN
  -- Tenant-ownership re-check (defense in depth; mirrors 033).
  IF NOT EXISTS (
    SELECT 1 FROM members
    WHERE id = p_member_id AND restaurant_id = p_restaurant_id
  ) THEN
    RAISE EXCEPTION 'apply_stamp: member not found or cross-tenant: % / %',
      p_member_id, p_restaurant_id;
  END IF;

  SELECT * INTO v_campaign FROM stamp_campaigns
    WHERE id = p_campaign_id AND restaurant_id = p_restaurant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'apply_stamp: campaign not found or cross-tenant: % / %',
      p_campaign_id, p_restaurant_id;
  END IF;

  -- (1) Lock the in-progress card (create + snapshot terms if absent).
  SELECT * INTO v_card FROM member_stamp_cards
    WHERE member_id = p_member_id AND campaign_id = p_campaign_id
      AND status = 'in_progress'
    FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO member_stamp_cards (
      restaurant_id, member_id, campaign_id,
      stamps_required, reward_id
    ) VALUES (
      p_restaurant_id, p_member_id, p_campaign_id,
      v_campaign.stamps_required, v_campaign.reward_id
    )
    RETURNING * INTO v_card;
  END IF;

  -- (2) Server-derived HK-local stamp date; find the lowest free in-day slot.
  v_stamp_date := (now() AT TIME ZONE 'Asia/Hong_Kong')::date;
  v_base_key := p_campaign_id::text || ':' || v_stamp_date::text;

  -- (3/4) Insert the stamp ledger row; ON CONFLICT DO NOTHING = the cap/idempotency.
  v_seq := 1;
  LOOP
    -- For the default cap (1) the key is just base; for cap>1 we append :N
    -- and advance to the next free slot on conflict.
    IF p_max_per_day <= 1 THEN
      v_key := v_base_key;
    ELSE
      v_key := v_base_key || ':' || v_seq::text;
    END IF;

    INSERT INTO events (restaurant_id, member_id, type, actor_user_id,
                        dedup_key, data_json)
    VALUES (p_restaurant_id, p_member_id, 'stamp', p_actor_user_id, v_key,
            jsonb_build_object('campaign_id', p_campaign_id, 'card_id', v_card.id))
    ON CONFLICT (restaurant_id, member_id, dedup_key)
      WHERE type = 'stamp' AND dedup_key IS NOT NULL
    DO NOTHING;

    IF FOUND THEN
      v_inserted := TRUE;
      EXIT;
    END IF;

    -- Conflict: this slot is taken. At cap (or default), the cap is reached.
    EXIT WHEN p_max_per_day <= 1 OR v_seq >= p_max_per_day;
    v_seq := v_seq + 1;
  END LOOP;

  IF NOT v_inserted THEN
    -- Already hit the cap today → no increment, no further writes.
    RETURN QUERY SELECT 'already_stamped_today'::text, v_card.stamps_count,
      v_card.stamps_required, v_card.id, FALSE, v_key;
    RETURN;
  END IF;

  -- (5) Project the increment onto the denormalized read cache.
  v_card.stamps_count := v_card.stamps_count + 1;
  v_completed := v_card.stamps_count >= v_card.stamps_required;

  -- (6) Complete in-place when threshold reached (app layer mints + opens next card).
  UPDATE member_stamp_cards
     SET stamps_count = v_card.stamps_count,
         status       = CASE WHEN v_completed THEN 'completed' ELSE status END,
         completed_at = CASE WHEN v_completed THEN now() ELSE completed_at END,
         updated_at   = now()
   WHERE id = v_card.id;

  RETURN QUERY SELECT 'stamped'::text, v_card.stamps_count, v_card.stamps_required,
    v_card.id, v_completed, v_key;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.apply_stamp(UUID, UUID, UUID, UUID, INT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.apply_stamp(UUID, UUID, UUID, UUID, INT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.apply_stamp(UUID, UUID, UUID, UUID, INT) TO service_role;

-- ============================================================================
-- (G) reverse_stamp RPC — manual audited correction; floored at 0; no dedup_key.
-- ============================================================================
CREATE OR REPLACE FUNCTION reverse_stamp(
  p_restaurant_id UUID,
  p_member_id     UUID,
  p_campaign_id   UUID,
  p_actor_user_id UUID
) RETURNS TABLE (
  -- out_-prefixed for the same column-shadowing reason as apply_stamp.
  out_outcome         TEXT,    -- 'reversed' | 'at_zero'
  out_stamps_count    INT,
  out_stamps_required INT,
  out_card_id         UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_card member_stamp_cards%ROWTYPE;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM members
    WHERE id = p_member_id AND restaurant_id = p_restaurant_id
  ) THEN
    RAISE EXCEPTION 'reverse_stamp: member not found or cross-tenant: % / %',
      p_member_id, p_restaurant_id;
  END IF;

  SELECT * INTO v_card FROM member_stamp_cards
    WHERE member_id = p_member_id AND campaign_id = p_campaign_id
      AND status = 'in_progress'
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reverse_stamp: no in-progress card for member %', p_member_id;
  END IF;

  -- No-op at zero (CHECK stamps_count >= 0 also guards underflow).
  IF v_card.stamps_count = 0 THEN
    RETURN QUERY SELECT 'at_zero'::text, 0, v_card.stamps_required, v_card.id;
    RETURN;
  END IF;

  -- Append-only reversal event (intentionally repeatable → NO dedup_key).
  INSERT INTO events (restaurant_id, member_id, type, actor_user_id, data_json)
  VALUES (p_restaurant_id, p_member_id, 'stamp_reversal', p_actor_user_id,
          jsonb_build_object('campaign_id', p_campaign_id, 'card_id', v_card.id));

  v_card.stamps_count := v_card.stamps_count - 1;
  UPDATE member_stamp_cards
     SET stamps_count = v_card.stamps_count, updated_at = now()
   WHERE id = v_card.id;

  RETURN QUERY SELECT 'reversed'::text, v_card.stamps_count,
    v_card.stamps_required, v_card.id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reverse_stamp(UUID, UUID, UUID, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reverse_stamp(UUID, UUID, UUID, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_stamp(UUID, UUID, UUID, UUID) TO service_role;
