---
id: artifacts/2026-11-27-book-013-phone-optional-handoff
type: handoff
contract: handoff-file-v1
author: dev
created: 2026-11-27
status: active
supersedes: null
superseded_by: null
item: BOOK-013
state: done
brief: inline (BOOK-013 decision 9, phone optional for staff bookings + review N1)
base: 2f922d5b
head: see PR #236 (code bbe713bf; this file is in the records commit after it)
branch: feature/book-013-phone-optional
pushed: true
stage: poc
suite_changed: "yes, once, deliberately: staff-booking.test.ts AC-4 case 'phone missing → required' became 'phone not text → invalid' (decision 9 makes an empty phone valid). Every other change only adds tests."
gate: {result: pass, at: 2026-11-27T06:30Z}
next: {owner: main, action: "review PR #236 (2f922d5b..branch tip); release 096 after 095, before restart"}
blockers: []
refs: [pr:236, kanban:BOOK-013, specs/2026-11-26-book-013-staff-booking-crud, threats/2026-11-26-book-013-staff-booking-crud, plans/2026-11-26-book-013-staff-booking-crud, reviews/2026-11-26-book-013-r3-re-review, artifacts/2026-11-27-book-013-phone-optional-impl]
related: [artifacts/2026-11-26-book-013-r3-handoff]
---
ac:
  AC-1: {result: pass, evidence: "evidence/2026-11-27-book-013-phone-optional/scratch-db-096.log: 22/22 on a throwaway supabase/postgres 17.6 container (port 55366, DB dropped, container removed). Covers a phone-less staff_create with notify true (stored false); refusal of phone-less chat, campaign and agent rows; refusal of a phone-less row with notify true; a staff_update clearing a non-staff phone (0 rows); existing rows unchanged; grants and signatures unchanged; reminder candidates. Red: scratch-db-096-red.log, 13 FAIL on 095 alone."}
  AC-2: {result: pass, evidence: "red.log: 35 failing before the code. touched-tests.log: 20 files, 323 tests green. Covers create/edit/cancel/decide/reminder with a null phone and notify true (stored false, sender spy empty, no outcome recorded); clearing the phone on a chat, campaign or agent booking (400 phone_required, row unchanged, no writes); clearing on a staff booking (phone and member_id null); adding a phone (member linked; message only on a party/date/time change); agent API still requires a phone; N1 under time, guests and status, asc and desc."}
  AC-3: {result: pass, evidence: "evidence/2026-11-27-book-013-phone-optional/walk-log.md: zh-HK and en at 1440 and 390. Each run passed 29/29 checks, with 17 screenshots, 0 console errors and 0 confirmed blocking (ui-layout-audit). The fake Kapso log shows 0 message sends over all runs. Fake data only."}
  AC-4: {result: pass, evidence: "build.log exit 0, then tsc.log exit 0. vitest-full.log exit 0: 733 files passed and 17 skipped; 8660 tests passed, 140 skipped, 2 todo. eslint.log: 49 problems, the same file+rule set as the develop baseline (0 new, 0 gone). Pushed: ls-remote == HEAD bbe713bf. PR #236 into develop is open and not merged; its body maps AC-26..AC-29 and R19/R20 to tests and states the release order."}
decisions:
  - "R20 answer: 400 {error: 'phone_required', fields: {phone: 'required'}}, so the form shows 'Required.' on Phone through the existing invalid path."
  - "N1: unnamed (null or empty) rows sort last wherever the name decides the order, i.e. under the Name key and in the name tie-break. They are not moved past named rows at other times under Time, Guests or Status, which keeps the meal grouping intact."
  - "Phone label: 'Phone (optional)' / '電話（選填）' on a new booking or a staff-source edit; any other source keeps 'Phone'."
  - "Editing a phone-less booking starts with Notify ticked, so adding a phone offers it checked (AC-28). With the phone empty it shows unticked and disabled."
  - "No new test ids: 'No phone' and the hint are static copy (getByText); the inputs keep their ids."
  - "The reminder SQL is unchanged: the 096 CHECK forces notify off, which 095's candidate filter already excludes. The cron also filters with hasPhone."
  - "Local DB: 096 applied with `supabase migration up --local` on the existing 001..095 volume (no reset)."
failed:
  - tried: "walk checks reading notify_diner through psql text concatenation"
    why: "boolean || text prints true/false, not t/f, so 4 checks failed on correct data"
    evidence: "first zh-1440 run"
    replaced_by: "CASE WHEN notify_diner THEN 't' ELSE 'f' END; all runs 29/29"
  - tried: "plain git push of the records commit"
    why: "remote hung up on the 5 MB evidence push (RTK printed 'Everything up-to-date')"
    evidence: "ls-remote still at bbe713bf"
    replaced_by: "git -c http.postBuffer=524288000 push; ls-remote == 3a72ec6b"
invariants:
  - "No booking without a phone reaches a sender (staff, decide, reminder, received, agent verify)."
  - "Only source 'staff' rows may have a null phone; this is enforced by the DB CHECK, the RPC WHERE and the use case."
  - "095 not edited."
unverified:
  - "Real WhatsApp/Meta delivery (faked locally)."
  - "Impeccable detect on live routes (login needed). Static detect on the 4 changed UI files returned []."
review_focus:
  - "096 staff_update_booking WHERE (p_phone IS NOT NULL OR b.source = 'staff') and notify_diner = p_notify AND p_phone IS NOT NULL"
  - "staff-booking-input.ts parsePhone / notify forcing; edit-staff-booking.ts phone_required + memberFor"
  - "hasPhone guards in decide-booking-request.ts, send-booking-reminders.ts, staff-booking-shared.ts"
scope_drift: []
in_flight: []
next_step: "Review PR #236; release: apply 096 after 095, before the restart."
---

Notes:
- **Open question for the owner.** A staff member can still link a phone-less booking to a member by hand with the BOOK-008 chip. The spec says "no member link", but it covers only the automatic link. The next edit that saves without a phone clears that manual link.
- `next dev` rewrites the tree's `CLAUDE.md` on start, and the Supabase CLI touches `supabase/.temp/cli-latest`. Both were restored with `git checkout` and are in no commit.
