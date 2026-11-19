---
id: artifacts/2026-11-19-dev-book-004-r4-handoff
type: handoff
contract: handoff-file-v1
author: dev
created: 2026-11-19
status: active
supersedes: artifacts/2026-11-19-dev-book-004-r3-handoff
superseded_by: null
item: BOOK-004
state: done
brief: inline
base: 4fa9a30a
head: 7c1c38c2
branch: feature/bookings-calendar-table
pushed: true
stage: poc
gate: {result: pass, at: 2026-11-19, note: "tsc --noEmit clean + full vitest 652 files / 7451 tests passed (13 files skipped) under the heavy lock; eslint on the 56 TS/TSX files the merge changed, exit 0; Impeccable source detector on the bookings UI, no findings"}
next: {owner: verifier, action: "re-review the merge resolution 4fa9a30a..7c1c38c2 (repository, use-bookings, booking-row, views), then merge PR #196 into develop and release"}
blockers: []
refs: [artifacts/2026-11-19-book-004-bookings-views-impl, artifacts/2026-11-19-book-004-bookings-views-ux, artifacts/2026-11-19-dev-book-004-r3-handoff]
---
ac:
  AC-1: {result: pass, evidence: "evidence/2026-11-19-book-004-r4/ac1-merge-tree.log: git merge-tree --write-tree origin/develop HEAD exit 0 (tree 2bac1a48, no conflicts); git grep for conflict markers finds none. gh pr view 196 mergeable: see the dev return (after push)"}
  AC-2: {result: pass, evidence: "ac2-red.log: 16 failing before the fix (repository range/pending, groups, runDecision+handler, view renders); ac2-green.log: 7 files / 112 tests passed incl. develop's booking-change-ui.test.tsx and the F8 showsUndelivered test"}
  AC-3: {result: pass, evidence: "ac3-gate.log exit 0 (652 files / 7451 tests); ac3-lint-changed-files.log exit 0"}
  AC-4: {result: pass, evidence: "ac4-walk.log + ac4-calendar-day-panel-1440-zh.jpeg, ac4-table-1440-zh.jpeg, ac4-table-cards-390-zh.jpeg, ac4-calendar-day-list-390-zh.jpeg; fake tenant removed by exact id (ac4-cleanup.log: 0 left, auth user deleted 200)"}
  AC-5: {result: pass, evidence: "timeout 120 rtk proxy git push 4fa9a30a..e58fc4a2; ls-remote sha == HEAD e58fc4a2; gh pr view 196 MERGEABLE / CLEAN at e58fc4a2. This file's own fix commit is pushed after it"}
decisions:
  - "Cancelled has its own status chip (bookings-filter-cancelled), like Declined; All shows no number"
  - "AGENT-003 row parts extracted as exported CancelledByBadge / ChangeFromLine / cancelledText in booking-row.tsx and used by the day row, desktop table and phone cards; BookingRow itself is the day-list row only"
  - "decisionOutcomeHandler extracted from useBookingActions so runDecision's onOutcome (F4) is unit-tested with the F8 rule (no DOM renderer in the repo)"
  - "bookings.partyOf restored with develop's exact values: r3 F7 removed it as an orphan; AGENT-003's change-from line uses it"
  - "r3 tests changed deliberately: the range allow-list test expects cancelled; three statusCounts expectations carry cancelled: 0. No case removed or weakened"
failed:
  - tried: "test probe reading the nearest class attribute before the time text"
    why: "the strike is on the parent element (cards <p>, chip <span>), so the inner span's class never carried it"
    evidence: "ac2 first green run: 2 failures in bookings-views-agent003.test.tsx"
    replaced_by: "rowOf (a row's whole markup) and chipTag (the chip's opening tag by title)"
invariants:
  - "Every dashboard booking read stays scoped by restaurant_id in the query (R1), including the replaced-slot read"
  - "Unverified never reaches staff views (R2): range allow-list is pending, confirmed, declined, cancelled; pending list eq(status, pending)"
  - "Cancelled is excluded from guests, the needs-reply count (server countRestaurantPendingBookings) and the needs-reply list"
  - "r3 F1-F6 unchanged: readCap/cappedList + cap 999, bookingsSettler keyRef guard + current-key refetch, phone-calendar filter bypass, runDecision busy-until-refetch, month-scoped counts, phone-digit search guard"
unverified:
  - "en locale not walked (local locale env-fixed to zh-HK); en strings covered by the key-existence test"
  - "withReplacedSlots uses .in('id', ids) for the change requests in a range (at most ~999 rows); a range with several hundred change requests could hit the PostgREST content-location header limit (memory principle_postgrest_in_filter_header_overflow). Realistic counts are tiny; not chunked"
  - "Table footer 'Showing N upcoming bookings' counts cancelled rows too (they are listed); not changed"
review_focus:
  - "src/infrastructure/supabase/repositories/booking-request-repository.ts: STAFF_COLUMNS + withReplacedSlotsIn on both new lists"
  - "src/hooks/use-bookings.ts: act -> runDecision with decisionOutcomeHandler (showsUndelivered)"
  - "src/components/dashboard/booking-row.tsx conflict resolution (develop's flat row replaced by the BOOK-004 split + extracted AGENT-003 parts)"
scope_drift:
  - "Outside files_allowed only through the develop merge, content unchanged from develop: .env.example, supabase/migrations/085_agent_booking_changes.sql"
  - "CLAUDE.md: next dev re-added its nextjs-agent-rules block; restored, not committed (as r2/r3)"
  - ".claude/reflection-queue: untracked before this run, not touched"
next_step: "Re-review the merge resolution, then merge PR #196 into develop."
---
Notes:
- Walk: local Supabase CLI stack (already running, migration 085 present), `next dev -p 3030` with the local URL/keys in the process env. Fake tenant b0040000-…0044, user book004-r4-staff@example.test, 6 bookings; deleted by exact id afterwards, auth user deleted; no other tenant's rows existed or were touched.
- Live check of the merged decision path: declining the change request returned `delivered: null`, the row went to Declined with no not-delivered badge.
- Rot seen, not repaired (as r3): INDEX.md is far over its ~50-line budget; `handoffs.md` does not exist.
