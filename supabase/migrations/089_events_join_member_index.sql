-- 089_events_join_member_index.sql
-- WONB-020 r3 (PR #212 review): index the join-event lookup.
--
-- Every JOIN by an existing member now asks "has this member ever had a
-- `join` event here?" (hasJoinEvent, src/infrastructure/supabase/repositories/
-- event-repository.ts) on the webhook path:
--
--   SELECT id FROM events
--   WHERE restaurant_id = $1 AND member_id = $2 AND type = 'join' LIMIT 1;
--
-- Before this migration `events` had no index on member_id (001 indexes
-- restaurant_id, created_at and type only; 050's uq_events_stamp_dedup is
-- partial on type = 'stamp'), so the lookup walked every event of the tenant.
--
-- NOT unique: existing data may already hold more than one join event for a
-- member, and the WONB-020 failed-claim path may write another. Partial on
-- type = 'join' keeps the index to one small slice of the table.
--
-- coupons needs no new index: the claim check's two coupon lookups
-- (findLatestWelcomeOfferCode) are served by 076's uniq_coupons_welcome_member
-- (restaurant_id, member_id) WHERE type = 'welcome' AND member_id IS NOT NULL,
-- and by 001's idx_coupons_member_id (member_id is a per-member UUID, so the
-- restaurant_id filter only re-checks a handful of rows).
--
-- DEPLOY NOTE (same as 080): a plain CREATE INDEX blocks writes to `events`
-- for the build. BEFORE applying, check the table size:
--   SELECT count(*) FROM events;   -- or pg_total_relation_size('events')
-- If it is large, pre-create the index OUTSIDE a transaction first:
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_events_join_restaurant_member
--     ON events (restaurant_id, member_id) WHERE type = 'join';
-- The statement below keeps IF NOT EXISTS, so it is then a no-op.
-- Idempotent: safe to run twice. No code depends on it; apply any time.

CREATE INDEX IF NOT EXISTS idx_events_join_restaurant_member
  ON events (restaurant_id, member_id)
  WHERE type = 'join';
