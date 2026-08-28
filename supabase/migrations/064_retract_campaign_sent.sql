-- 064_retract_campaign_sent.sql
-- #131: Meta rejects some campaign sends ASYNCHRONOUSLY, after the
-- synchronous batch already tallied them as sent and bumped
-- chargeable_sent_count / non_chargeable_sent_count (migration 027) and
-- possibly flipped the campaign to 'completed' (#127 / migration 062).
-- Two Kushiro campaigns billed 4 phantom chargeable sends this way.
--
-- retract_campaign_sent() is the mirror image of increment_chargeable_sent /
-- increment_non_chargeable_sent: called from the status-webhook path
-- (reconcile-campaign-send-failure.ts) when a `failed` status lands for a
-- campaign body message. It decrements the bucket matching the ROW's own
-- is_chargeable (never read-then-decide in JS — the row is the source of
-- truth for whether ITS send was billable) and, in the SAME statement, flips
-- a `completed` campaign to `failed` once BOTH buckets have drained to zero
-- (Amendment 1 / A2: atomicity — no separate read-then-decide round trip
-- that a concurrent retract or finalize could race). failure_reason is
-- caller-supplied (src/domain/services/campaign-delivery-failure-reason.ts)
-- so the tenant sees why, naming Meta as the deciding system (WAQ-014).
--
-- Every expression reads the row's CURRENT column values inside the UPDATE
-- itself — deliberately NOT via a CTE that pre-computes the new counts. A
-- CTE evaluates under the statement's snapshot, so two `failed` webhooks
-- for the same campaign arriving together would both compute n-1 from the
-- same n and the second write would be lost (over-billing, the exact #131
-- direction). Inline expressions are re-evaluated against the row version
-- the UPDATE actually locks, so concurrent retractions serialise correctly.
--
-- Scoped by (id, restaurant_id) — authorize by scoped query (SEC-001
-- precedent), not fetch-then-compare. Returns zero rows when nothing
-- matched; the repository wrapper treats that as "no-op" rather than
-- assuming success.

CREATE OR REPLACE FUNCTION public.retract_campaign_sent(
  p_campaign_id uuid,
  p_restaurant_id uuid,
  p_failure_reason text
)
RETURNS TABLE (
  status text,
  chargeable_sent_count int,
  non_chargeable_sent_count int
) AS $$
  UPDATE campaigns c
  SET
    chargeable_sent_count =
      GREATEST(0, c.chargeable_sent_count - (CASE WHEN c.is_chargeable THEN 1 ELSE 0 END)),
    non_chargeable_sent_count =
      GREATEST(0, c.non_chargeable_sent_count - (CASE WHEN c.is_chargeable THEN 0 ELSE 1 END)),
    status = CASE
      WHEN c.status = 'completed'
        AND GREATEST(0, c.chargeable_sent_count - (CASE WHEN c.is_chargeable THEN 1 ELSE 0 END)) = 0
        AND GREATEST(0, c.non_chargeable_sent_count - (CASE WHEN c.is_chargeable THEN 0 ELSE 1 END)) = 0
        THEN 'failed'
      ELSE c.status
    END,
    failure_reason = CASE
      WHEN c.status = 'completed'
        AND GREATEST(0, c.chargeable_sent_count - (CASE WHEN c.is_chargeable THEN 1 ELSE 0 END)) = 0
        AND GREATEST(0, c.non_chargeable_sent_count - (CASE WHEN c.is_chargeable THEN 0 ELSE 1 END)) = 0
        THEN p_failure_reason
      ELSE c.failure_reason
    END
  WHERE c.id = p_campaign_id AND c.restaurant_id = p_restaurant_id
  RETURNING c.status, c.chargeable_sent_count, c.non_chargeable_sent_count;
$$ LANGUAGE sql;
