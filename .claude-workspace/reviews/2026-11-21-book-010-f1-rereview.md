---
id: reviews/2026-11-21-book-010-f1-rereview
type: review
author: verifier
mode: re-review
reviewer_model: claude-opus (single model)
created: 2026-11-21
status: active
supersedes: reviews/2026-11-21-book-010-review
superseded_by: null
related: [reviews/2026-11-21-book-010-review, artifacts/2026-11-21-book-010-f1-handoff, specs/2026-11-20-book-010-guest-limits-and-stop, kanban:BOOK-010]
---

# Code Review: BOOK-010 F1 fix round (PR #223), re-review round 1

## Summary

**What was reviewed.**
- Range `a4416924..b3d0a740` on `feature/book-010-guest-limits` (tree `whatsapp-crm--book-010`, HEAD `b3d0a740`).
- 5 commits, 30 files: 17 source and test files, migration 093, and the workspace records.
- The scope is the brief's `fixed` list: P2-1, P3-1, P3-2 (the DELETE half and the spec line only), P3-3, P3-4 and P3-5.
- Every claim below was checked in the tree at HEAD, not taken from the handoff.

**What was run.**
- The brief's AC-3 command: 27 files, 23 passed and 4 skipped (the `.db` tests, which need `RUN_DB_TESTS`). 372 tests passed, 36 skipped, 0 failed.
- 17 more touched-area files: booking-hours, agent-booking domain, change tools, AI tools, confirm-recheck, lifecycle, the schedule-switch and schedule-room tests, hours routes, the submit room and schedule-off routes, capacity schedule-off, submit-booking-request, the two capacity UI tests, and the booking-room limits and schedule-switch tests. 271 passed, 0 failed.
- Not run again by me:
  - the scratch Postgres run of 093 and the PostgREST smoke. I relied on `tests/evidence/2026-11-21-book-010-f1/ac2-093-scratch.log`: `proconfig {"search_path=public, pg_temp"}` on both SECURITY DEFINER functions, and 093 re-applied cleanly;
  - `ac2-postgrest-after-093.log` (3/3, including the P3-3 stored-row assertion);
  - `tsc` and the full suite, which are heavy gate steps. Their logs show exit 0.

**Red-first check.** `red-run.log` shows the 11 new tests failing over the `a4416924` code, each for the reason of its finding.

**Scope.** Every change in the range traces to the six findings or to the round's records. The dev committed my own untracked original review file and its INDEX line, and declared it as `scope_drift`. That is workspace records only, so `escalate_if` did not fire.

**Result.**
- All six findings are resolved.
- AC-10 holds: neither `decide-booking-request` nor `booking-over-limit` is in the range, and no new path gates a staff confirm.
- `roomApplies` is still the only gate on every new room read.
- One new minor issue (N1, P3): the code-step room read is not best effort.

## Finding status (AC-1)

| Finding | Status | Evidence (HEAD `b3d0a740`) |
|---|---|---|
| **P2-1** Rules-refusal suggestions ignore room | **Resolved** | **PAP create:** `create-agent-booking.ts:259-264` builds `fits` via `suggestionFits` when `deps.room && roomApplies && isHoursRefusal`, and passes it at `:274-275`. `deps.room` is wired in `booking-deps.ts` `createAgentBookingDeps` (`room: bookingRoomStore`).<br>**AI propose / create / confirm-change:** `agent-booking-rules.ts:64-68`; `roomContext` (`:123-128`) gates on `call.booking.room && roomApplies(hours)`; `fits` is passed at `:78-80`.<br>**Code step:** `recheck-agent-bookings.ts:60-70` (lazy, one read per message), applied at `:83-84` only when `check.kind === 'rules'`. The domain `recheckAgentBooking` takes `fits` (`agent-booking-recheck.ts:25-36`). Wired: `VerifyAgentBookingDeps` passes `deps` with `room: agentBookingRoom` (`booking-deps.ts` `verifyAgentBookingDeps`) into `recheckAgentBookings` (`verify-agent-booking.ts:86`). That is the only caller; the webhook reaches it through `booking-confirm-code-handler.ts:25`.<br>**Tests, red then green:** `agent-booking-room.test.ts` "F1 P2-1" (propose, create, confirm-change, plus the schedule-off guard); `agent-booking-room-routes.test.ts` "F1 P2-1" (closed day with full and stopped times, too_far, code step) |
| **P3-1** A refusal reads the window twice | **Resolved** | `booking-room-check.ts:51-55`: `earlyFull` reads once and builds suggestions from the same `RoomState` (`suggestionsIn`, `:39-43`). `insertWithRoom` still reads once after the RPC refuses (`:83`), which the original finding allowed. Tests: "F1 P3-1" PAP POST and AI propose both assert `readRoom` is called once |
| **P3-2** (DELETE half and spec line) | **Resolved** | `booking-capacity.ts:100-110` `storedTarget` checks shape only (scope, non-empty `periodLabel`, `HH:MM` time). It is used for resume at `:116`, after the calendar-date and past-date checks (`:114-115`). POST still validates against the hours (`targetOn`). The spec's Explicitly Not Handled list has the new line at `specs/2026-11-20-book-010-guest-limits-and-stop.md:144`. Tests: "P3-2: DELETE removes a stored stop whose period label is no longer in the hours" and "DELETE still refuses a malformed body". The period-rename half is out of scope per the brief |
| **P3-3** A repeated stop POST reports the caller | **Resolved** | The port `BookingStopStore.add` now returns `Promise<BookingStop>` (`ports/booking.ts`). The repository does `insert().select(STOP_COLUMNS).single()` (`booking-room-repository.ts:89-99`), and on `23505` calls `findStop` (`:76-86`). `findStop` is NULL-aware: `.is(...,null)` vs `.eq` on `period_label` and `slot_time`, the same filter shape as `removeBookingStop`. It matches the `booking_stops_one UNIQUE NULLS NOT DISTINCT (restaurant_id, booking_date, scope, period_label, slot_time)` key (`092:33`). `slot_time` is TEXT `HH:MM` (`092:23`), so `.eq` matches exactly. The application answers with the stored name and time (`booking-capacity.ts:139-140`). Tests: the route test and the real-PostgREST test (`booking-room-postgrest.db.test.ts:95-99`, log `ac2-postgrest-after-093.log`) |
| **P3-4** SECURITY DEFINER `search_path` without `pg_temp` | **Resolved** | `093_booking_room_search_path.sql:22-26` `ALTER FUNCTION … SET search_path = public, pg_temp` on both SECURITY DEFINER functions. The signatures match 092 exactly (`092:130-136`, `:191-198`, `:178`, `:258`). The other three 092 functions are not SECURITY DEFINER (`prosecdef f` in the scratch log), so `public` alone is fine for them. Applied in order 091 → 092 → 093 and re-applied cleanly (`ac2-093-scratch.log`). Not re-run by me |
| **P3-5** Staff badge differs from the diner today | **Resolved** | `domain/services/booking-capacity.ts:125-133`: when `date === clock.today`, the badge is judged over `slotsFor(hours, date, clock)`, which applies the same notice and window filter the diner and `/availability` use. Other dates are unchanged. The clock comes from `deps.now()` (`application/booking/booking-capacity.ts:68-69`) and reaches both the month badge (`:76`) and the day panel (`:73`). Test: "P3-5: today is judged over the times a diner can still pick" |

## Regression check (AC-2)

| Area | Result | Evidence |
|---|---|---|
| Async `parseProposal` / `parseAgreed` call sites | **No regression** | Grep finds exactly 4 call sites, all awaited: `agent-booking-tools.ts:123,145`, `agent-booking-change-tools.ts:161` (via `changedSubmission`, `:147`, which returns the promise) and `:187`. `parseAgreed`'s early `TERMS_CHANGED` return is wrapped in `Promise.resolve` (`agent-booking-rules.ts:96`). A missed `await` would fail `tsc` (`.ok` on a `Promise`), and `tsc.log` shows exit 0 |
| `suggestionFits` read window | **Correct** | It reads `[from, windowEnd]` with `from = date` when `today < date ≤ end`, else `today` (`booking-room-check.ts:63-67`). `suggestTimes` only visits `max(date, today)..windowEnd` (`booking-hours.ts:105-106`). The too_far branch suggests from `windowEnd` and then from today, inside `[today, end]`. So every date a suggestion can land on is inside the read, and `fitsFor` is never asked about an unread date, which it would read as empty and so as fitting. A garbage `date` string falls to `from = today`, and `suggestTimes` yields nothing for it. The read only happens on an hours refusal (`isHoursRefusal`), so ordinary invalid bodies cost no query |
| 23505 NULL-aware stored-row lookup | **Correct** | See the P3-3 row. The only other unique key on `booking_stops` is the uuid primary key, so `23505` here means `booking_stops_one`. A delete racing between the failed insert and `findStop` makes `findStop` throw, which the API answers as 500. This is theoretical, and not a finding |
| `roomApplies` stays the single gate | **Holds** | Each new read is behind `roomApplies`: PAP `create-agent-booking.ts:261`, AI `roomContext` `agent-booking-rules.ts:125`, code step `recheck-agent-bookings.ts:63`, and the capacity badge behind the existing `roomApplies` at `booking-capacity.ts:73,76`. Guard test: "schedule off → no room read" (`agent-booking-room.test.ts`). Resume no longer needs `roomApplies`, by design (P3-2): staff can delete a stored stop with the schedule off. It is still tenant- and role-scoped through `staffContext` and the `restaurant_id` filter in `removeBookingStop` |
| Staff confirm never blocked (AC-10) | **Holds** | No file on the confirm path is in the range. The existing AC-10 tests in `bookings-capacity.test.ts` pass |
| PAP `parseInput` moved inside `try` | **No regression** | `create-agent-booking.ts:290-292`: an invalid body still returns `invalid` with `suggestedTimes`. Only a thrown room read now ends as `failed`, matching the other reads in the same `try` |
| Code-step read failure handling | **N1, P3** | See below |

## 🔴 Critical (Must Fix)

None.

## 🟡 Important (Should Fix)

None.

## 🟢 Minor (Optional)

### N1 (new, P3): a failing room read at the code step now aborts the whole confirm message

**Where.** `src/application/booking/recheck-agent-bookings.ts:60-70,84`.

**Problem.** The lazy `reader.readRoom` call is not guarded. If it throws, the error passes through `recheckAgentBookings` and then `verifyAgentBooking:86`, both before `promote`. The webhook handler catches it, logs `handler.agent_booking_check_failed` and returns `false` (`booking-confirm-code-handler.ts:33-36`). So:
- the rules-refused row is not declined and no reply is sent;
- any other valid codes in the same message are not promoted;
- the message falls through to normal routing.

Before F1, the same row would have been declined with rules-only alternatives. The other room read on this path, `tellFull`, is deliberately best effort (`agent-booking-full-reply.ts:37-47`, try/catch).

**Risk.** Low. It needs a transient database or PostgREST failure on the counts RPC or the stops select. The promote RPC on the same database would likely fail as well, and the diner can resend the code.

**Fix.** Wrap the read in `roomFitsFor` with a catch that logs and returns `undefined`, which gives rules-only alternatives, as `tellFull` does.

**How to show it fails.** In the code-step test in `agent-booking-room-routes.test.ts`, make the fake room's `readRoom` reject. `verifyAgentBooking` rejects, where the expected result is the row `declined`/`rules` with one reply.

## ✅ Strengths

- Every finding has a red-first test that fails for the stated reason (`red-run.log`). The failed first attempt for P3-5 is recorded in the handoff, with why it passed red.
- The P2-1 read is bounded: at most one window read per request (PAP, AI) or per message (code step), and only on an hours refusal while room rules apply.
- `suggestionsIn` keeps the read and the suggestion computation apart, which fixed P3-1 with no change of behaviour.
- 093 is a separate migration rather than an edit of 092, it is idempotent, and it has a rollback line.
- The P3-3 fix goes through the port, so the fake store and the real repository share one contract, and a real-PostgREST test pins it.

## Open Questions

1. **Orphaned stops cannot be deleted from the UI.** The spec line says "staff can still delete it". The API allows it now, but `capacityDay` lists period stops only for the periods in the current hours (`domain/services/booking-capacity.ts:98`). A stop on a renamed period therefore does not appear in the dashboard and can only be removed through the API. It no longer applies, so this is leftover data, not wrong behaviour. Two side effects:
   - renaming the period back makes the stop apply again;
   - this sits outside the F1 scope (the ruling kept the rename half out).
2. **A today badge with no slots left.** Today after the last bookable time, `slotsFor` returns nothing, so the staff badge is `full: false`. The diner sees no times rather than 已滿, so the two agree. It is noted as a change from the old grid-wide badge only.
3. **The release open questions from the original review stay open:** the Postgres 15+ requirement for `NULLS NOT DISTINCT` on DEV/prod, TTFB not measured, and deploy order. The order is now 091 → 092 → 093 before any deploy (in the PR body, according to the handoff; I did not check the PR).

## Verdict: APPROVED

## Next Steps

- Merge per the owner's approval. N1 is optional: fix it in a follow-up or list it in the PR.
- Release runbook: apply migrations 091 → 092 → 093 in order before deploying the code.
