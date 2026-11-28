-- 028_drop_legacy_campaign_counters.sql
-- Run only after confirming no app instances reference sent_count or
-- increment_campaign_sent. Deploy migration 027 + new app code first,
-- observe for 24h, then apply 028.
--
-- Migration 027 added split counters (chargeable_sent_count /
-- non_chargeable_sent_count) and the new increment RPCs, but intentionally
-- left the legacy `sent_count` column and `increment_campaign_sent(uuid)`
-- function in place so rolling-deploy windows with old + new app instances
-- coexisting do not crash. This migration finalises that removal.

BEGIN;

ALTER TABLE campaigns DROP COLUMN IF EXISTS sent_count;

DROP FUNCTION IF EXISTS public.increment_campaign_sent(uuid);

COMMIT;
