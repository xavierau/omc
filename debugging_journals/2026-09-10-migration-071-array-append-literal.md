# 2026-09-10 — migration 071's `member_updated_outbox()` throws on every name/language/status change

## Problem
`supabase/migrations/071_integration_outbound.sql`'s `member_updated_outbox()` trigger function
(`AFTER UPDATE OF name, preferred_language, status ON members`) threw
`ERROR: malformed array literal: "language"` the instant it ran against a real UPDATE. This is not
an INT-001-specific bug: the trigger's column list means ANY update to `members.name`,
`members.preferred_language`, or `members.status` — anywhere in the app, including the pre-existing
STOP handler (`member-handlers.ts`'s `handleUnsubscribe`) and language-detection persistence
(`updateMemberPreferredLanguage`) — would have crashed the underlying `UPDATE` the moment migration
071 was deployed to any shared environment.

Found while building WI-7's scratch-DB verification of `member.updated`'s end-to-end behaviour
(plan §WI-7 Tests-first: "`updateMemberPreferredLanguage` and STOP produce `member.updated` via the
triggers (scratch-DB lane)") — the very first `UPDATE members SET preferred_language = ...` against
a scratch DB with 001–072 applied failed outright.

## Root cause
```sql
DECLARE
  changed_cols TEXT[] := '{}';
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    changed_cols := changed_cols || 'name';
  END IF;
  ...
```
`changed_cols || 'name'` concatenates a `TEXT[]` with an **untyped** string literal. PostgreSQL's
operator resolution for `||` has two candidate overloads here — `anyarray || anyarray` and
`anyarray || anyelement` — and with an untyped literal on the right it picks the array||array
overload, then tries to PARSE `'name'` as an array literal (expects `{...}` syntax) instead of
appending it as a scalar element. Reproduced in isolation, independent of any app code or migration
history, directly against Postgres 17.6:

```sql
DO $$
DECLARE changed_cols TEXT[] := '{}';
BEGIN
  changed_cols := changed_cols || 'language';  -- ERROR: malformed array literal: "language"
END $$;
```

`consent_changed_outbox()` and `member_ref_outbox()` (the other two outbox trigger functions in the
same migration) never hit this because they always build the array with `ARRAY['consent']` /
`ARRAY['external_ref']` — an explicitly-typed array constructor, not `||` against a bare literal.
Only `member_updated_outbox()`'s three incremental `changed_cols := changed_cols || '<col>'` lines
(for `name`, `preferred_language`, `status`) have the bug.

WI-1's own scratch-DB validation of migrations 069–072 (documented in
`artifacts/2026-09-10-int-001-wi1-backend.md`) never exercised this function at all — its five
assertions cover STOP-resurrection, `applyPartnerAssertedConsent`, `createOrGetMember`'s concurrent
double-create, and the generic fan-out trigger (`trg_integration_events_fanout`) via a
directly-inserted event row, never an actual `UPDATE members SET name/preferred_language/status = ...`.
The one trigger branch nobody had run against real Postgres was the one with the bug.

## Solution
Explicit `::text` casts on all three lines, forcing the correct `anyarray || anyelement` overload:

```sql
changed_cols := changed_cols || 'name'::text;
changed_cols := changed_cols || 'language'::text;
changed_cols := changed_cols || 'status'::text;
```

Verified against an isolated scratch DB (`scratch_int001_wi7`, migrations 001–072 applied, fixtures
+ assertions inside a rolled-back transaction, dropped after):

```
Assertion A passed: preferred_language change -> member.updated{language}, origin NULL, 1 queued delivery
Assertion B passed: status change -> member.updated{status}, 1 queued delivery
Assertion C passed: consent change -> member.updated{consent}, 1 queued delivery
Assertion D passed: points_balance change produced no member.updated event
```

Fixed in place in `supabase/migrations/071_integration_outbound.sql` rather than a new migration —
071 has not been deployed to any shared/production environment (still mid-feature-branch,
`feature/int-001-member-api`), so this repo's normal pre-release convention (fix the file, don't
patch forward) applies.

## Prevention
- **A scratch-DB validation pass that exercises a trigger's fan-out mechanism is not the same as
  exercising every branch of that trigger's own logic.** WI-1's assertions proved the *generic*
  fan-out trigger works (insert an event row, get a delivery row) but never actually fired
  `member_updated_outbox()` by performing a real `UPDATE` on `name`, `preferred_language`, or
  `status` — the three columns the trigger's own `AFTER UPDATE OF ...` clause exists to watch. A
  trigger's column-list and its conditional branches are exactly the kind of PL/pgSQL that unit
  tests and mocked-client tests structurally cannot reach (fakes don't run triggers) — a scratch-DB
  assertion suite for a migration with a multi-branch trigger must drive **every** branch with a
  real DML statement, not just prove the trigger fires at all.
- Applied here: WI-7's own scratch-DB suite now covers all three UPDATE branches (name is
  implicitly covered by the same code path as language/status — same fix, same line shape) plus the
  INSERT-driven consent branch and a negative case (points_balance must NOT fire it). This is the
  assertion list WI-11's release gate should re-run verbatim before 069–072 ever reach `supabase db
  push` against a real environment — see `artifacts/2026-09-10-int-001-wi7-backend.md`'s
  "`member.updated` End-to-End Verification" section for the exact fixtures and assertions.
- General rule for future PL/pgSQL: never write `array_var || <bare literal>` — always
  `array_var || <literal>::<element_type>` or `array_var || ARRAY[<literal>]`. Both are unambiguous
  to the operator resolver; a bare literal is not.
