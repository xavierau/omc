-- 068_upsert_tags_by_name.sql
-- TAG-001 / #138a: commit-time get-or-create for the per-row CSV `tags` column.
--
-- Tag names arrive from a CSV as free text; the commit path must turn them into
-- tag ids, creating only the ones the tenant does not already have, matching
-- case-insensitively against idx_tags_restaurant_lower_name (migration 065).
--
-- Why an RPC and not PostgREST (plan AD-2 -> Amendment AM-2): PostgREST cannot
-- express `WHERE lower(name) IN (...)` safely (`.in('name', …)` is
-- case-sensitive; an `.or('name.ilike.…')` filter string is an injection
-- surface) and cannot target an EXPRESSION unique index via `onConflict`, so a
-- plain upsert is unavailable. SQL can do both.
--
-- Why plpgsql and not a single SQL statement: a data-modifying CTE
-- (`WITH inserted AS (INSERT … RETURNING …) SELECT … FROM tags`) evaluates the
-- outer SELECT under the statement's snapshot, so rows the CTE just inserted
-- are invisible to it — the same snapshot trap migration 064 documents. Two
-- separate statements under READ COMMITTED give the SELECT a fresh snapshot,
-- which also lets it see a row a CONCURRENT import committed between the two
-- (the ON CONFLICT DO NOTHING skips it, so it is not in any RETURNING). That
-- concurrency case is exactly why no 23505 retry loop is needed in the app.
--
-- p_names is deduplicated case-insensitively INSIDE the function: a single
-- INSERT carrying both 'VIP' and 'vip' cannot conflict-skip itself (two rows in
-- one statement do not see each other's tuples), so it would raise 21000/23505
-- despite ON CONFLICT. DISTINCT ON keeps the first-seen casing, matching
-- normalizeImportTagNames() on the app side.
--
-- Blank / whitespace-only entries are dropped (they would otherwise create a
-- junk tag that passes the 1..40 char CHECK). Over-length names are NOT
-- filtered: the `tags_name_check` CHECK from 065 is allowed to raise so the
-- caller learns the name was rejected instead of silently losing it.
--
-- Writer: service-role only, called from
-- src/infrastructure/supabase/repositories/tag-get-or-create.ts. Locked down
-- with the migration-064 REVOKE/GRANT pattern — under Supabase's default
-- EXECUTE TO PUBLIC any dashboard session could otherwise mint tags in an
-- arbitrary restaurant through a first-class RPC name (p_restaurant_id is
-- trusted as given; the caller is what scopes it to the tenant).

CREATE OR REPLACE FUNCTION public.upsert_tags_by_name(
  p_restaurant_id uuid,
  p_names text[]
)
RETURNS TABLE (id uuid, name text)
LANGUAGE plpgsql
SECURITY INVOKER
VOLATILE
AS $$
#variable_conflict use_column
BEGIN
  INSERT INTO tags (restaurant_id, name)
  SELECT p_restaurant_id, w.n
  FROM (
    SELECT DISTINCT ON (lower(btrim(u.n))) btrim(u.n) AS n
    FROM unnest(p_names) WITH ORDINALITY AS u(n, ord)
    WHERE btrim(coalesce(u.n, '')) <> ''
    ORDER BY lower(btrim(u.n)), u.ord
  ) AS w
  ON CONFLICT (restaurant_id, lower(name)) DO NOTHING;

  RETURN QUERY
  SELECT t.id, t.name
  FROM tags t
  WHERE t.restaurant_id = p_restaurant_id
    AND lower(t.name) = ANY (
      SELECT lower(btrim(u.n))
      FROM unnest(p_names) AS u(n)
      WHERE btrim(coalesce(u.n, '')) <> ''
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.upsert_tags_by_name(uuid, text[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.upsert_tags_by_name(uuid, text[]) FROM anon;
REVOKE EXECUTE ON FUNCTION public.upsert_tags_by_name(uuid, text[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_tags_by_name(uuid, text[]) TO service_role;
