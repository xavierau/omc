---
id: artifacts/2026-11-27-book-013-phone-optional-r2-handoff
type: handoff
contract: handoff-file-v1
author: dev
created: 2026-11-27
status: active
supersedes: null
superseded_by: null
item: BOOK-013
state: done
brief: inline brief-v1 BOOK-013 (AC-26 revision 2026-11-27, no manual member link without a phone)
base: faa2314f
head: "code f291d61e (spec copy eca424e9); this file is in the records commit after it"
branch: feature/book-013-phone-optional
pushed: true
stage: poc
suite_changed: "no: tests only added (5 route cases, 4 component cases); no existing case changed"
gate: {result: pass, at: 2026-11-27T06:33Z}
next: {owner: main, action: "review PR #236 delta faa2314f..branch tip (AC-26 manual-link guard)"}
blockers: []
refs: [pr:236, kanban:BOOK-013, specs/2026-11-26-book-013-staff-booking-crud, artifacts/2026-11-27-book-013-phone-optional-handoff, artifacts/evidence/2026-11-27-book-013-phone-optional-r2/walk-log]
related: [artifacts/2026-11-27-book-013-phone-optional-handoff]
---
ac:
  AC-1: {result: pass, evidence: "evidence/2026-11-27-book-013-phone-optional-r2/ac1-route-red.log (2 fail: 200 not 400) and ac1-ui-red.log (4 fail) before the code; ac1-green.log 2 files 54/54. Route: link on phone-less → 400 {error:'phone_required'}, member_id unchanged, no events row; relink on a phone-less row still holding a member → 400, link unchanged; unlink on phone-less → 200 + one events row; staff booking with a phone links as before; other tenant's phone-less booking stays 404. Component: no booking-row-<id>-member-link on the phone-less row in desktop table, phone cards and calendar day panel while the phone row keeps it; a phone-less linked row offers only Unlink (click → link(id, null)); phone-less unlinked → renders nothing."}
  AC-2: {result: pass, evidence: "evidence/2026-11-27-book-013-phone-optional-r2/walk-log.md + walk-steps-{zh,en}-{1440,390}.json + 28 screenshots: 12/12 checks per run, 0 console errors, 0 confirmed blocking. Real nav to Today, Calendar day panel, Table; phone-less 'Walk-in Ho' has no Link member, 'Mr Chan' (phone) has it and links/unlinks through the UI; signed-in PATCH on the phone-less booking → 400 phone_required, member_id NULL, 0 events. Fake data only."}
  AC-3: {result: pass, evidence: "Under resource-lock heavy: build.log build-exit=0, then tsc.log tsc-exit=0, vitest-full.log vitest-exit=0 (733 files passed / 17 skipped; 8669 tests passed, 140 skipped, 2 todo). eslint.log: src/ problem set identical to the r1 run that matched develop (49 = 49 file+rule, 0 new, 0 gone); the whole-repo run also lists the tracked .agents/ scripts and older evidence scripts, none changed since base; walk-r2.mjs lint-clean. Pushed, ls-remote == HEAD; PR #236 body has the AC-26 manual-link section."}
decisions:
  - "Guard in the use case (relinkBookingMember), matching its existing Result reasons (not_found | conflict, now + phone_required); the route maps it to 400. Uses the domain hasPhone, the same predicate the senders use."
  - "Order: booking lookup first (other tenant / unknown stays 404), then phone_required for a non-null memberId, then the member lookup. So a phone-less booking with an unknown member id answers phone_required."
  - "Relink (Change member) on a phone-less row that still holds a member is refused too: it is a manual link. Unlink is allowed and is the only control shown on such a row."
  - "UI: MemberLinkControl hides the Link/Change button when !hasPhone; nothing rendered when also unlinked. No new copy, no new test id. Today has no link control (BOOK-008 never put one there), so nothing changed there."
  - "No DB change: the RPC relink_booking_member stays as is (supabase/ outside files_allowed); the app guard is the only refusal, the same as the other relink checks."
failed:
  - tried: "starting this repo's local Supabase on its own ports"
    why: "another project's stack (ebclub) held 54321/54322 and was in use"
    evidence: "docker ps at 14:2xZ"
    replaced_by: "scratch copy of supabase/config.toml with ports 543xx → 554xx, same project_id so the existing 001–096 volume was reused; stopped after, volume kept"
invariants:
  - "A booking without a phone never gains a member through the manual path (API and UI)."
  - "Unlink always works; tenant scope and role checks unchanged."
  - "A phone added later sends nothing unless date, time or party changed (untouched)."
unverified:
  - "Impeccable detect on live routes (login needed); static detect on booking-member.tsx returned []."
  - "No DB-level refusal: a direct RPC call with the service role could still link a phone-less row (only the staff route calls it)."
review_focus:
  - "src/application/booking/relink-booking-member.ts phone_required branch and its position"
  - "src/components/dashboard/bookings/booking-member.tsx MemberLinkControl linkable branch"
scope_drift: []
in_flight: []
next_step: "Review PR #236 delta; release unchanged (096 after 095)."
---

Notes:
- `next dev` rewrote the tree's `CLAUDE.md` again; it was restored with `git checkout` and is in no commit.
- Evidence drivers live in `artifacts/evidence/2026-11-27-book-013-phone-optional-r2/` (`seed-walk-r2.sh`, `dev-run-r2.sh`, `walk-r2.mjs`); they reuse r1's `seed-walk.sql` and `fake-kapso.cjs` by relative path.
