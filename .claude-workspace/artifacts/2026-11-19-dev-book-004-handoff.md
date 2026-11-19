---
id: artifacts/2026-11-19-dev-book-004-handoff
type: handoff
contract: handoff-file-v1
author: dev
created: 2026-11-19
status: active
item: BOOK-004
state: done
brief: inline (brief-v1 BOOK-004, 2026-11-19)
base: 49a3f582
head: 94bbfda4
branch: feature/bookings-calendar-table
pushed: true
stage: poc
gate: {result: fail, at: 2026-11-19T09:42Z, note: "tsc + full vitest green; repo-wide lint red on 131 untouched files, changed files lint clean"}
next: {owner: verifier, action: "vision on evidence/2026-11-19-book-004/screens + audits, or review 49a3f582..HEAD"}
blockers: []
refs: [artifacts/2026-11-19-book-004-bookings-views-ux, artifacts/2026-11-19-book-004-bookings-views-impl]
---
ac:
  AC-1: {result: pass, evidence: "npx vitest run src/app/api/dashboard/bookings/__tests__ → 2 files, 25 tests; red first evidence/2026-11-19-book-004/ac1-red.log (12 failing)"}
  AC-2: {result: pass, evidence: "npx vitest run src/components/dashboard/__tests__ src/hooks/__tests__ → 68 files, 841 tests (Nov 2026 grid Sun 1 Nov, 5 rows; groups, covers, filter, search; booking UI tests on every rendering)"}
  AC-3: {result: fail, evidence: "evidence/.../ac3-gate.log: tsc pass; npm run lint 151 errors / 22 warnings, all in 131 files this branch does not touch (none booking); ac3-lint-changed-files.log exit 0; ac3-vitest.log 644 files / 7258 tests pass (run separately after lint stopped the chain)"}
  AC-4: {result: pass, evidence: "screens/ac4-calendar-1440-en.jpeg, ac4-calendar-390-en.jpeg, ac4-calendar-1440-after-confirm.jpeg (Confirm on Chat Diner: badge + chip Confirmed, pill 4→3)"}
  AC-5: {result: pass, evidence: "screens/ac6-table-1440-zh.jpeg, ac5-table-390-en.jpeg, ac5-table-past-1440-en.jpeg (Show past = 90 days newest first), ac5-needs-reply-show-1440-en.jpeg (Table + Pending, 3 rows), ?view=table direct load"}
  AC-6: {result: pass, evidence: "screens/ac6-*-zh.jpeg; no bookings.* raw keys in main innerText; audits/*.json 0 blocking on all 8 (en + zh, calendar + table, 1440 + 390)"}
  AC-7: {result: pass, evidence: "push + PR in the dev return; kanban BOOK-004 (review); 8 testid-registry rows; poc-log line; ux spec + designs/ .pen + PNGs committed"}
decisions:
  - "Range params both-or-neither; one alone → 400 — a half range has no defined meaning"
  - "Range query status allow-list in(pending,confirmed,declined) instead of neq(unverified) — same rows on base; keeps a parallel branch's 085 'cancelled' status out until decided"
  - "One layout per view via matchMedia (useIsPhone) — the brief's one-copy-per-row rule; month grid/week strip are not rows"
  - "Phone calendar hides the status chips and search (mock calendar-390 has none); phone table shows them"
  - "Phone header hides the description line (mocks show none); copy unchanged"
  - "Table views carry -via-agent on the Source cell, not a second badge; the day panel keeps the badge"
  - "Two tokens added (--pending-soft, --pending-foreground): amber accent text on white fails contrast at 12px"
failed:
  - tried: "next dev with the worktree .env.local (DEV Supabase)"
    why: "DEV lacks booking migrations (memory incident_no_browser_env_for_db_features)"
    evidence: "environments.md"
    replaced_by: "env overrides to the already-running local Supabase CLI stack (54321) for the dev server only"
invariants:
  - "Every booking_requests read for the dashboard is scoped by restaurant_id inside the query (R1)"
  - "Unverified bookings never reach staff views (R2)"
  - "Search text never enters the URL (R6)"
unverified:
  - "Rendered-route Impeccable detector (needs a signed-in session) — owner: verifier vision"
  - "A real WhatsApp delivery after Confirm (no Kapso phone locally; the not-delivered badge showed as designed) — owner: release"
  - "Table at 1440 in en with no filter: shot taken in zh-HK (ac6-table-1440-zh) and en past range; the en upcoming shot was filtered by a search the browser tool did not clear (ac5-search-phone-digits-1440-en)"
review_focus:
  - "src/hooks/use-bookings.ts useBookings: range-keyed data + refetch after decisions"
  - "src/infrastructure/supabase/repositories/booking-request-repository.ts listBookingRequestsInRange: filters + cap+1"
  - "src/components/dashboard/bookings/use-bookings-page.ts: view resolution, router.replace, localStorage via useSyncExternalStore"
scope_drift: []
next_step: "Dispatch verifier (vision) on evidence/2026-11-19-book-004, then decide on the repo-wide lint debt before treating AC-3 as a gate."
---
