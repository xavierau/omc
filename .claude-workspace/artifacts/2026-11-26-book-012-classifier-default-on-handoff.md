---
id: artifacts/2026-11-26-book-012-classifier-default-on-handoff
type: handoff
contract: handoff-file-v1
author: dev
created: 2026-11-26
status: active
item: BOOK-012
state: done
brief: inline
base: c37fdba0
head: 135e2f69
branch: feature/book-012-classifier-default-on
pushed: true
stage: poc
suite_changed: false
gate: {result: pass, at: 2026-11-26}
next: {owner: main, action: "review PR #230 (c37fdba0..135e2f69), then owner go for release (migration 094 before restart)"}
blockers: []
refs: [pr:230, kanban:BOOK-012, kanban:BOOK-001, kanban:AGENT-004]
---
ac:
  AC-1: {result: pass, evidence: "src/domain/value-objects/__tests__/booking-config.test.ts describe 'aiRoutingEnabled is an opt-out (BOOK-012)': RED at 66f4e61d (11 failing), green at 135e2f69"}
  AC-2: {result: pass, evidence: "route-booking-intent.test.ts 'default on (BOOK-012)', book-routing.test.ts 'BOOK-012 the classifier is on by default', agent-routing.test.ts '(g)' x2; RED at 66f4e61d, 4 files 137/137 green at 135e2f69"}
  AC-3: {result: pass, evidence: "scratch Postgres transcript below (scratch_book012 on the local supabase_db_whatsapp-crm server, 93 migrations applied, dropped after)"}
  AC-4: {result: pass, evidence: "vitest run: 726 files passed, 17 skipped; 8408 tests passed, 140 skipped, 2 todo (43.5s). tsc --noEmit exit 0. Both under resource-lock heavy, once. No flaky WAQ reruns needed"}
  AC-5: {result: pass, evidence: "https://github.com/xavierau/omc/pull/230; ls-remote SHA 135e2f69ee355fbffc4f560475578ce8cd328129 == HEAD at PR open; checks: CodeRabbit pass (review skipped for base develop); the repo has no .github/workflows, so no test CI ran"}
decisions:
  - "Migration bumps booking_config.rev: every writer (changeBookingConfig: settings PUT, template provisioning, template edit, candidate promotion, agent booking save) CAS-checks rev and spreads the resolved current config, so a writer that read before 094 would pass its guard and write aiRoutingEnabled false back. Bump rule mirrors writeIfUnchanged: integer rev + 1, else 1 [booking-config-repository.ts:71]"
  - "Migration name: 094_booking_ai_routing_default_on.sql"
  - "Tests: no existing test was default-false-only, so none updated or deleted. Existing explicit-false cases (route-booking-intent 'aiRoutingEnabled false', book-routing 'aiRoutingEnabled false') stay as the opt-out proof. New tests added to the 4 named files"
  - "WHERE matches the JSON boolean false only. A stored string 'false' is left as is (the parser already resolves it to true)"
  - "Kanban: BOOK-012 added under review with PR #230"
failed: []
invariants:
  - "isBookingIntentRoutingOn is the only production reader of aiRoutingEnabled (grep src: booking-intent.ts:34 via route-booking-intent.ts:54); no other behaviour changes"
  - "parseBookingSettings still rejects aiRoutingEnabled in the body (unknown_field) and carries the stored value through"
unverified:
  - "That prod's stored-false tenants are exactly 釧 Kushiro and Bicho: taken from the brief, prod not queried. Owner/main: SELECT name FROM restaurants WHERE booking_config->'aiRoutingEnabled' = 'false'::jsonb before release"
  - "Gemini quota: memory incident_prod_gemini_key_free_tier (2026-11-20) said the prod key was on free tier (20 req/day/model). Default-on raises classifier calls; failures fail open to the fallback menu (BOOK-001 AC-6). Not checked whether billing was fixed"
  - "No real-browser / WhatsApp walk: backend-only change, proven by routeMessage tests"
review_focus:
  - "supabase/migrations/094_booking_ai_routing_default_on.sql: rev bump CASE and the WHERE"
  - "src/domain/value-objects/booking-config.ts:188 r.aiRoutingEnabled !== false"
scope_drift:
  - "none. Stale comment not touched (outside files_allowed): src/application/booking/route-booking-intent.ts:6 still calls aiRoutingEnabled the 'eval gate'"
in_flight: []
next_step: "Review PR #230, then release with migration 094 applied before the app restart."
---

# BOOK-012 handoff

The worktree `../whatsapp-crm--book-012` didn't exist, so dev created it (slot 6) from base c37fdba0, which was also origin/develop at the time. Develop had not moved by PR time.

## AC-3 transcript (migration 094 on scratch Postgres, rolled back)

Build: a fresh `scratch_book012` database on 127.0.0.1:54322 with auth/storage/extensions/realtime stubs. Migrations 001..093 applied in filename order with ON_ERROR_STOP ("applied 93 migrations"). Then the script below ran, and the database was dropped.

`booking_config` is NOT NULL in 082, so a NULL blob can't occur on a real database. To seed one as the brief asks, the script drops NOT NULL inside the rolled-back transaction only.

```sql
\set ON_ERROR_STOP 1
\pset pager off
BEGIN;
-- AC-3 extra seed: booking_config is NOT NULL in 082, so a NULL blob cannot exist
-- on a real database. Dropped here, inside the rolled-back txn only, to prove the
-- WHERE clause would leave one alone.
ALTER TABLE public.restaurants ALTER COLUMN booking_config DROP NOT NULL;

INSERT INTO public.restaurants (name, slug, whatsapp_number, booking_config) VALUES
  ('false_external', 's1', '+85200000001', '{"mode":"external","externalUrl":"https://book.example/k","aiRoutingEnabled":false,"rev":7,"bookingRules":"last order 21:00","templateIds":{"received":{"en":"t1","zh_hk":null}}}'),
  ('false_no_rev',   's2', '+85200000002', '{"mode":"simple","aiRoutingEnabled":false,"maxPartySize":8}'),
  ('true_simple',    's3', '+85200000003', '{"mode":"simple","aiRoutingEnabled":true,"rev":3}'),
  ('key_absent',     's4', '+85200000004', '{"mode":"external","externalUrl":"https://book.example/a","rev":2}'),
  ('null_config',    's5', '+85200000005', NULL),
  ('off_false',      's6', '+85200000006', '{"mode":"off","aiRoutingEnabled":false,"rev":1}'),
  ('string_false',   's7', '+85200000007', '{"mode":"simple","aiRoutingEnabled":"false","rev":4}');

CREATE TEMP TABLE before_snap AS SELECT id, name, booking_config FROM public.restaurants WHERE slug LIKE 's_';

\echo '--- before'
SELECT name, booking_config FROM before_snap ORDER BY name;

\echo '--- apply 094 (first run)'
\i /Users/xavierau/Code/js/whatsapp-crm--book-012/supabase/migrations/094_booking_ai_routing_default_on.sql

\echo '--- after'
SELECT r.name, r.booking_config->'aiRoutingEnabled' AS ai, b.booking_config->'rev' AS rev_before, r.booking_config->'rev' AS rev_after,
       (r.booking_config IS NOT DISTINCT FROM b.booking_config) AS unchanged,
       ((r.booking_config - 'aiRoutingEnabled' - 'rev') IS NOT DISTINCT FROM (b.booking_config - 'aiRoutingEnabled' - 'rev')) AS other_keys_identical
FROM public.restaurants r JOIN before_snap b USING (id) ORDER BY r.name;

\echo '--- assertions (each must be t)'
SELECT 'only false rows changed' AS check,
  (SELECT array_agg(r.name ORDER BY r.name) FROM public.restaurants r JOIN before_snap b USING (id)
     WHERE r.booking_config IS DISTINCT FROM b.booking_config) = ARRAY['false_external','false_no_rev','off_false'] AS ok
UNION ALL SELECT 'false rows now true',
  (SELECT bool_and(booking_config->'aiRoutingEnabled' = 'true'::jsonb) FROM public.restaurants WHERE name IN ('false_external','false_no_rev','off_false'))
UNION ALL SELECT 'other keys identical on every row',
  (SELECT bool_and((r.booking_config - 'aiRoutingEnabled' - 'rev') IS NOT DISTINCT FROM (b.booking_config - 'aiRoutingEnabled' - 'rev'))
     FROM public.restaurants r JOIN before_snap b USING (id))
UNION ALL SELECT 'rev 7 -> 8, absent -> 1, 1 -> 2',
  (SELECT array_agg(booking_config->>'rev' ORDER BY name) FROM public.restaurants WHERE name IN ('false_external','false_no_rev','off_false')) = ARRAY['8','1','2']
UNION ALL SELECT 'null blob still null',
  (SELECT booking_config IS NULL FROM public.restaurants WHERE name = 'null_config');

\echo '--- re-run the UPDATE (second run must report UPDATE 0)'
\set QUIET 0
\i /Users/xavierau/Code/js/whatsapp-crm--book-012/supabase/migrations/094_booking_ai_routing_default_on.sql
\set QUIET 1
ROLLBACK;
\echo '--- rolled back; seeded rows left:'
SELECT count(*) FROM public.restaurants WHERE slug LIKE 's_';
```

```
Pager usage is off.
BEGIN
ALTER TABLE
INSERT 0 7
SELECT 7
--- before
      name      |                                                                                          booking_config                                                                                          
----------------+--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
 false_external | {"rev": 7, "mode": "external", "externalUrl": "https://book.example/k", "templateIds": {"received": {"en": "t1", "zh_hk": null}}, "bookingRules": "last order 21:00", "aiRoutingEnabled": false}
 false_no_rev   | {"mode": "simple", "maxPartySize": 8, "aiRoutingEnabled": false}
 key_absent     | {"rev": 2, "mode": "external", "externalUrl": "https://book.example/a"}
 null_config    | 
 off_false      | {"rev": 1, "mode": "off", "aiRoutingEnabled": false}
 string_false   | {"rev": 4, "mode": "simple", "aiRoutingEnabled": "false"}
 true_simple    | {"rev": 3, "mode": "simple", "aiRoutingEnabled": true}
(7 rows)

--- apply 094 (first run)
UPDATE 3
--- after
      name      |   ai    | rev_before | rev_after | unchanged | other_keys_identical 
----------------+---------+------------+-----------+-----------+----------------------
 false_external | true    | 7          | 8         | f         | t
 false_no_rev   | true    |            | 1         | f         | t
 key_absent     |         | 2          | 2         | t         | t
 null_config    |         |            |           | t         | t
 off_false      | true    | 1          | 2         | f         | t
 string_false   | "false" | 4          | 4         | t         | t
 true_simple    | true    | 3          | 3         | t         | t
(7 rows)

--- assertions (each must be t)
               check               | ok 
-----------------------------------+----
 only false rows changed           | t
 false rows now true               | t
 other keys identical on every row | t
 rev 7 -> 8, absent -> 1, 1 -> 2   | t
 null blob still null              | t
(5 rows)

--- re-run the UPDATE (second run must report UPDATE 0)
UPDATE 0
--- rolled back; seeded rows left:
 count 
-------
     0
(1 row)
```
