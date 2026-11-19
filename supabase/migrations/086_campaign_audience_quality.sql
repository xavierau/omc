-- 086_campaign_audience_quality.sql (renumbered from 085: AGENT-003 landed 085_agent_booking_changes on develop first)
-- CAMP-016: tenant defaults for "skip low-quality contacts" and "lapsed
-- after N days", a per-campaign snapshot of both, and ONE server-side
-- audience resolver that the campaign form's count and the send share.
--
-- 1. tenant_campaign_settings gains the two defaults. ADD COLUMN ... DEFAULT
--    fills every existing row, and the 078 seed trigger inserts only
--    (restaurant_id, monthly_send_limit), so a new tenant's row gets the same
--    defaults from the column definitions: no trigger or backfill change is
--    needed to keep "a complete row for every tenant" (principle: per-tenant
--    settings seed on create).
--
-- 2. campaigns gains the snapshot, written at create (and on edit) from the
--    form, never read back from live settings at send time. Existing rows get
--    audience_skip_quality = 'off' and audience_lapsed_days = NULL, i.e. the
--    behaviour they had before this migration.
--
-- 3. campaign_audience_rated is the single filter definition:
--      active members of the audience (all | selected | tag)
--      → is_lapsed: last_visit_at older than p_lapsed_days, or never visited
--        and joined longer ago than that (COALESCE(last_visit_at, joined_at)
--        < cutoff: a member who joined 2 days ago is not sent a 30-day
--        win-back). p_never_visited_lapsed is false only for pre-086 win-back
--        campaigns, whose old `.lt('last_visit_at', cutoff)` read excluded
--        never-visited members altogether.
--      → rating: reproduces classifyContactQuality in
--        src/domain/value-objects/contact-quality.ts. Window and thresholds
--        arrive as parameters from that file (one source for the numbers);
--        counts mirror 080's member_delivery_quality (delivered = delivered
--        or read, failed = failed, queued/sent ignored). unreachable_at set →
--        red; no counted messages → 'unknown' (never excluded). The rate is
--        float8 division, the same IEEE double JS computes, so >= on the
--        boundary (0.9, 0.6) agrees with the TS classifier exactly.
--      → included: lapsed AND not skipped by p_skip ('off' | 'red' |
--        'red_yellow'; any other value includes nobody, failing visibly).
--    campaign_audience_members (paged, the send) and campaign_audience_counts
--    (the form summary and the Settings distribution bar) both read it, so
--    the number shown and the set sent come from the same predicate.
--
-- Tenant scoping (R3): members by m.restaurant_id; member_tags by
-- mt.restaurant_id too (a poisoned row must not pull a foreign member in,
-- as 067/079); campaign selection through campaigns.restaurant_id;
-- whatsapp_messages by w.restaurant_id (another tenant's rows never change a
-- rating). EXISTS for tags/selection dedupes a member carrying two tags.
--
-- Paging: keyset — p_limit rows with id > p_after_id, ORDER BY id, walked by
-- readAllPagesAfterId (resolve-campaign-members-chunks.ts); a set-returning
-- RPC is subject to PostgREST max-rows. Not OFFSET: a rating is computed per
-- page, so a member who turns red (or visits) between two page fetches would
-- shift every later row up one position and the row on the page boundary
-- would never be sent. Member ids never travel back through a URL filter:
-- the selected-members preview passes p_member_ids in the RPC's POST body.
--
-- Lockdown: the 064 REVOKE PUBLIC/anon/authenticated + GRANT service_role
-- pattern on all three; they return member PII (phones).
--
-- Callers (service role only): src/infrastructure/supabase/repositories/
-- campaign-audience-repository.ts, used by resolve-campaign-members.ts (send),
-- POST /api/dashboard/campaigns/audience-count (form summary) and
-- GET /api/dashboard/settings/campaigns/quality (distribution bar). The two
-- routes return aggregates only.
--
-- Reversible: DROP the three functions and the four columns (the snapshot
-- columns default to the old behaviour, so dropping them loses only new
-- campaigns' filter choices).

ALTER TABLE tenant_campaign_settings
  ADD COLUMN IF NOT EXISTS skip_contact_quality text NOT NULL DEFAULT 'red'
    CHECK (skip_contact_quality IN ('off', 'red', 'red_yellow')),
  ADD COLUMN IF NOT EXISTS lapsed_after_days int NOT NULL DEFAULT 30
    CHECK (lapsed_after_days BETWEEN 1 AND 365);

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS audience_skip_quality text NOT NULL DEFAULT 'off'
    CHECK (audience_skip_quality IN ('off', 'red', 'red_yellow')),
  ADD COLUMN IF NOT EXISTS audience_lapsed_days int NULL
    CHECK (audience_lapsed_days IS NULL OR audience_lapsed_days BETWEEN 1 AND 365);

CREATE OR REPLACE FUNCTION public.campaign_audience_rated(
  p_restaurant_id uuid,
  p_audience text,
  p_tag_ids uuid[],
  p_member_ids uuid[],
  p_campaign_id uuid,
  p_lapsed_days int,
  p_never_visited_lapsed boolean,
  p_skip text,
  p_window_days int,
  p_green float8,
  p_yellow float8
) RETURNS TABLE (
  id uuid,
  restaurant_id uuid,
  phone text,
  name text,
  points_balance int,
  status text,
  joined_at timestamptz,
  last_visit_at timestamptz,
  preferred_language text,
  pmm_throttled_until timestamptz,
  unreachable_at timestamptz,
  is_lapsed boolean,
  rating text,
  included boolean
) AS $$
  WITH audience AS (
    SELECT m.id, m.restaurant_id, m.phone, m.name, m.points_balance,
           m.status, m.joined_at, m.last_visit_at, m.preferred_language,
           m.pmm_throttled_until, m.unreachable_at
    FROM members m
    WHERE m.restaurant_id = p_restaurant_id
      AND m.status = 'active'
      AND CASE p_audience
        WHEN 'all' THEN true
        WHEN 'tag' THEN EXISTS (
          SELECT 1 FROM member_tags mt
          WHERE mt.member_id = m.id
            AND mt.restaurant_id = p_restaurant_id
            AND mt.tag_id = ANY(p_tag_ids))
        WHEN 'selected' THEN CASE
          WHEN p_campaign_id IS NOT NULL THEN EXISTS (
            SELECT 1 FROM campaign_members cm
            JOIN campaigns c ON c.id = cm.campaign_id
            WHERE cm.campaign_id = p_campaign_id
              AND c.restaurant_id = p_restaurant_id
              AND cm.member_id = m.id)
          ELSE m.id = ANY(p_member_ids)
        END
        ELSE false
      END
  ),
  rated AS (
    SELECT a.*,
           (p_lapsed_days IS NULL
             OR a.last_visit_at < now() - make_interval(days => p_lapsed_days)
             OR (a.last_visit_at IS NULL AND p_never_visited_lapsed
                 AND a.joined_at < now() - make_interval(days => p_lapsed_days))) AS is_lapsed,
           CASE
             WHEN a.unreachable_at IS NOT NULL THEN 'red'
             WHEN q.delivered + q.failed = 0 THEN 'unknown'
             WHEN q.delivered::float8 / (q.delivered + q.failed) >= p_green THEN 'green'
             WHEN q.delivered::float8 / (q.delivered + q.failed) >= p_yellow THEN 'yellow'
             ELSE 'red'
           END AS rating
    FROM audience a
    CROSS JOIN LATERAL (
      SELECT count(*) FILTER (WHERE w.status IN ('delivered', 'read')) AS delivered,
             count(*) FILTER (WHERE w.status = 'failed') AS failed
      FROM whatsapp_messages w
      WHERE w.member_id = a.id
        AND w.restaurant_id = p_restaurant_id
        AND w.direction = 'outbound'
        AND w.queued_at >= now() - make_interval(days => p_window_days)
    ) q
  )
  SELECT r.id, r.restaurant_id, r.phone, r.name, r.points_balance, r.status,
         r.joined_at, r.last_visit_at, r.preferred_language,
         r.pmm_throttled_until, r.unreachable_at, r.is_lapsed, r.rating,
         r.is_lapsed AND (
           p_skip = 'off'
           OR (p_skip = 'red' AND r.rating <> 'red')
           OR (p_skip = 'red_yellow' AND r.rating NOT IN ('red', 'yellow'))
         ) AS included
  FROM rated r;
$$ LANGUAGE sql STABLE;

-- The first cut of this (unreleased) migration paged by p_offset int; drop
-- that signature so a database that ran it keeps no stale OFFSET overload.
DROP FUNCTION IF EXISTS public.campaign_audience_members(uuid, text, uuid[], uuid[], uuid, int, boolean, text, int, float8, float8, int, int);

CREATE OR REPLACE FUNCTION public.campaign_audience_members(
  p_restaurant_id uuid,
  p_audience text,
  p_tag_ids uuid[],
  p_member_ids uuid[],
  p_campaign_id uuid,
  p_lapsed_days int,
  p_never_visited_lapsed boolean,
  p_skip text,
  p_window_days int,
  p_green float8,
  p_yellow float8,
  p_limit int DEFAULT NULL,
  p_after_id uuid DEFAULT NULL
) RETURNS TABLE (
  id uuid,
  restaurant_id uuid,
  phone text,
  name text,
  points_balance int,
  status text,
  joined_at timestamptz,
  last_visit_at timestamptz,
  preferred_language text,
  pmm_throttled_until timestamptz,
  unreachable_at timestamptz
) AS $$
  SELECT r.id, r.restaurant_id, r.phone, r.name, r.points_balance, r.status,
         r.joined_at, r.last_visit_at, r.preferred_language,
         r.pmm_throttled_until, r.unreachable_at
  FROM public.campaign_audience_rated(
    p_restaurant_id, p_audience, p_tag_ids, p_member_ids, p_campaign_id,
    p_lapsed_days, p_never_visited_lapsed, p_skip, p_window_days, p_green, p_yellow
  ) r
  WHERE r.included
    AND (p_after_id IS NULL OR r.id > p_after_id)
  ORDER BY r.id
  LIMIT p_limit;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION public.campaign_audience_counts(
  p_restaurant_id uuid,
  p_audience text,
  p_tag_ids uuid[],
  p_member_ids uuid[],
  p_campaign_id uuid,
  p_lapsed_days int,
  p_never_visited_lapsed boolean,
  p_skip text,
  p_window_days int,
  p_green float8,
  p_yellow float8
) RETURNS TABLE (
  audience int,
  after_lapsed int,
  green int,
  yellow int,
  red int,
  no_data int,
  will_receive int
) AS $$
  SELECT count(*)::int,
         count(*) FILTER (WHERE r.is_lapsed)::int,
         count(*) FILTER (WHERE r.is_lapsed AND r.rating = 'green')::int,
         count(*) FILTER (WHERE r.is_lapsed AND r.rating = 'yellow')::int,
         count(*) FILTER (WHERE r.is_lapsed AND r.rating = 'red')::int,
         count(*) FILTER (WHERE r.is_lapsed AND r.rating = 'unknown')::int,
         count(*) FILTER (WHERE r.included)::int
  FROM public.campaign_audience_rated(
    p_restaurant_id, p_audience, p_tag_ids, p_member_ids, p_campaign_id,
    p_lapsed_days, p_never_visited_lapsed, p_skip, p_window_days, p_green, p_yellow
  ) r;
$$ LANGUAGE sql STABLE;

REVOKE EXECUTE ON FUNCTION public.campaign_audience_rated(uuid, text, uuid[], uuid[], uuid, int, boolean, text, int, float8, float8) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.campaign_audience_rated(uuid, text, uuid[], uuid[], uuid, int, boolean, text, int, float8, float8) FROM anon;
REVOKE EXECUTE ON FUNCTION public.campaign_audience_rated(uuid, text, uuid[], uuid[], uuid, int, boolean, text, int, float8, float8) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.campaign_audience_rated(uuid, text, uuid[], uuid[], uuid, int, boolean, text, int, float8, float8) TO service_role;

REVOKE EXECUTE ON FUNCTION public.campaign_audience_members(uuid, text, uuid[], uuid[], uuid, int, boolean, text, int, float8, float8, int, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.campaign_audience_members(uuid, text, uuid[], uuid[], uuid, int, boolean, text, int, float8, float8, int, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.campaign_audience_members(uuid, text, uuid[], uuid[], uuid, int, boolean, text, int, float8, float8, int, uuid) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.campaign_audience_members(uuid, text, uuid[], uuid[], uuid, int, boolean, text, int, float8, float8, int, uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.campaign_audience_counts(uuid, text, uuid[], uuid[], uuid, int, boolean, text, int, float8, float8) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.campaign_audience_counts(uuid, text, uuid[], uuid[], uuid, int, boolean, text, int, float8, float8) FROM anon;
REVOKE EXECUTE ON FUNCTION public.campaign_audience_counts(uuid, text, uuid[], uuid[], uuid, int, boolean, text, int, float8, float8) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.campaign_audience_counts(uuid, text, uuid[], uuid[], uuid, int, boolean, text, int, float8, float8) TO service_role;
