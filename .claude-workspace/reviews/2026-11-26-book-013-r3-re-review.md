---
id: reviews/2026-11-26-book-013-r3-re-review
type: review
author: verifier
mode: re-review
created: 2026-11-26
status: active
supersedes: null
superseded_by: null
related: [specs/2026-11-26-book-013-staff-booking-crud, threats/2026-11-26-book-013-staff-booking-crud, plans/2026-11-26-book-013-staff-booking-crud, artifacts/2026-11-26-book-013-r3-handoff, artifacts/2026-11-26-book-013-r2-handoff, kanban:BOOK-013, pr:235]
---

# Code Review: BOOK-013 round 3 (PR #235, 9c2e52ba..6005a899)

## Summary

The range is the same on origin: PR #235 head = `origin/feature/book-013-staff-booking-crud` = local HEAD = `6005a899`. Merge base with `origin/develop` is `4244ed63`.

Round 3 does what the brief asks:
- It removes the check-in code / QR feature: column, indexes, bucket, by-code route, scan UI, `p_codes`, the 5-arg `confirm_booking_change`, `forget_checkin_qr_paths`, the QR storage adapter, the image send path and the QR template upgrade.
- It adds the AC-25 Today sort.

Every send-path file now equals develop `4244ed63` byte for byte, except the R2 Notify-off early return and the owner-decision-6 `changed`/`cancelled` copy: `send-booking-message.ts`, `send-template-message.ts`, `enforce-header-media.ts`, `storage.ts`, `purge-booking-pii.ts`, `provision-booking-templates.ts`, `booking-template-body.ts` and `edit-booking-template.ts` show no diff against `4244ed63`.

The 095 `staff_create_booking` CTE is correct, and the scratch-DB log shows 54/54. The prior review findings R1, R2, R3, R7 and R8 stay fixed.

Findings: 0 critical, 0 important, 1 nit.

Checks run by the verifier:
- `git ls-remote` / `gh pr view 235`.
- `git diff 4244ed63..6005a899` on the send path.
- `git grep` for code/QR leftovers.
- An en/zh-HK i18n key parity script.
- A tsx probe of `sortTodayBookings` / `resolveTodaySort`.
- 14 touched test files: `vitest run`, 315/315 pass.

## 🔴 Critical (Must Fix)
None.

## 🟡 Important (Should Fix)
None.

## 🟢 Minor (Optional)

**N1 (nit): `src/domain/services/booking-today-sort.ts:43-46, 68`: an unnamed booking sorts *before* named ones as a tie-breaker.**
- **Problem:** The doc comment on `nameCompare` says "A missing name sorts after every named booking, in either direction". But `nameCompare` maps `null` to `''`, so `null` comes first. Only the `name` key puts unnamed rows last, through `unnamedLast`. Under Time, Guests or Status, the name tie-breaker on line 68 lists the unnamed booking first.
- **How to show it:** take two 19:00 bookings, one with `name: null` (a chat or agent booking without a name; `082` allows NULL) and one with "Chan". Sort by `{key:'time',dir:'asc'}` and the null row comes first. The verifier's probe printed `a:19:00:null | f:19:00:chan | b:19:00:Chan`.
- **Risk:** cosmetic. Spec AC-25 only says "Ties fall back to time, then name", so no AC is broken. The code and its own comment disagree.
- **Fix:** either move the null-last rule into `nameCompare`, so the tie-breaker matches the name key, or reword the comment so it applies only to the Name key.

## ✅ Strengths

**AC-2: prior findings, each still in force**

| Prior finding | Verdict | Evidence at HEAD |
|---|---|---|
| R1: background writes never bump `edit_version` | **Holds** | 095 §2b trigger unchanged apart from a comment; it compares only status, date, time, party, name, phone, notes, notify. `recordDecisionMessage`, the reminder claim, the staff message claim and check-in touch none of those. `bookings-staff-crud.test.ts:339-385` runs 4 background writes then edit/cancel 200, and 3 real changes then 409 with no write, events or sends. The only change from r2 is that the QR path claim left the list along with its column. Scratch DB rows 22-35 PASS. |
| R2: Notify off suppresses decide messages | **Holds** | `decide-booking-request.ts:98-99` returns `delivered: null` when `notifyDiner === false`. Decide and `confirm_booking_change` read `STAFF_COLUMNS`, which includes `notify_diner` (`booking-request-repository.ts:363, 380`). `book-013-decide-notify.test.ts` covers confirm and decline with Notify off (no send, no outcome) and Notify true/undefined (the exact develop payload). |
| R3: PII purge never blocked | **Holds (by removal)** | `purge-booking-pii.ts` and `purgeBookingPii` equal develop: one UPDATE, with no storage call before it. `BookingRetentionStore.purgePii` lost its `removeQrFiles` parameter. |
| R7: a change pair counts once | **Holds** | `booking-checkin.ts:62-72` (`pendingChangeOfListed`). `staff-booking.test.ts:161, 169` PASS. |
| R8: a staff message outcome never overwrites the confirmation badge | **Holds** | `staff-booking-shared.ts:89` records only `kind === 'confirmed'`; edit and cancel answer the outcome without storing it. `bookings-staff-crud.test.ts:274, 324` PASS. |

**AC-3: targeted verdicts**

- **`booking-today-sort.ts` comparator: PASS** (apart from nit N1, which concerns tie-breaks only).
  - Name key: null names last in both directions. `unnamedLast` is applied before the sign.
  - Ties: time, then name, both always ascending, because lines 67-68 are unsigned.
  - Status rank: Late 0, Waiting 1, Needs reply 2, Arrived 3, No-show 4. Desc reverses it (probe: `l,w,p,ar,ns` and `ns,ar,p,w,l`).
  - `other` (rank 5) never shows up: `listForDate` reads only pending, confirmed and no_show (`staff-booking.ts` port doc).
  - zh-HK uses the `Intl.Collator('zh-HK')` order: 陳生 sorts before Latin names in zh-HK and after them in en.
  - Guests sort largest first by default.
  - The input array is never changed (it is spread).
- **`bookings-view-state.ts` `resolveTodaySort` fallback: PASS.**
  - An unknown or case-mismatched key (`NAME`), or a missing key, falls back to `{time, asc}`.
  - A valid key with no `dir` gets the key's default (`guests` gives desc).
  - A valid key with an invalid or empty `dir` gives `{time, asc}`, as recorded in the r3 handoff decisions.
  - `todaySortSearch` round-trips (`bookings-today-sort-state.test.ts`).
- **095 `staff_create_booking`: PASS.**
  - It is a `LANGUAGE sql` function with two data-modifying CTEs. PostgreSQL runs a data-modifying CTE to completion whether or not the outer query reads it, so exactly one `events` row is written per insert. Scratch rows 2 and 4 PASS, using separate statements.
  - The function has 12 parameters. The REVOKE (from `PUBLIC, anon, authenticated`) and the GRANT (to `service_role`) both name that same 12-type signature.
  - The caller `staff-booking-repository.ts:44-58` sends the same 12 named args, with no `p_codes`.
  - No 13-arg grant or signature is left in 095.
  - Scratch row 52 shows one `staff_create_booking` with 12 args and no `text[]`. Row 51 shows only 085's 4-arg `confirm_booking_change`. Row 53 shows no anon or authenticated EXECUTE.
- **No leftover code/QR reference: PASS.**
  - Searched with `git grep -niE 'checkin_code|checkinCode|checkin_qr|checkinQr|booking-checkin-qr|bookings-today-scan|booking-scan|p_codes|forget_checkin|check-?in code|BK:'` over `src supabase scripts e2e`.
  - The only BOOK-013 hits are comments that cite decision 8 and absence assertions in tests: `staff-booking-repository.test.ts:48` (`not.toHaveProperty('p_codes')`) and `bookings-screen.test.tsx:137`.
  - The other `p_codes` hits are BOOK-003 agent confirm codes (084/092 and `agent-booking-repository.ts`), which predate this PR and are unrelated.
  - The `by-code` hits are only the coupon module, which is untouched.
  - `src/messages` lost `staff.code`, `staff.noCodeYet`, `today.scan*`, `today.code*`, `today.notFound` and `today.camera*`. en and zh-HK have identical key sets.
  - `scripts/ops/backfill-booking-templates.ts` no longer upgrades `confirmed`.
  - No route directory or untracked file is left under `src/app/api/dashboard/bookings/`.

**Fixed items**
- **Decision 8:** nothing left, as above.
- **Confirmation equals develop:** `decided()` now builds develop's inline payload: BODY only, with restaurant, name, date, time, party and decline reason, and no `image`. `BookingSendResult.via` lost `'image'`.
- **Table view unsorted:** `bookings-table-desktop.tsx` and `bookings-table-cards.tsx` only lost `CheckinCode`.
- **Arrived/Undo conditional on state:** unchanged.
- **Coupon / loyalty QR untouched:** no coupon, scan or QR file differs from develop. The `sidebar.tsx` change is the earlier round's S5 mode-off gate.

**Other**
- The Today sort composes with search: it filters, then sorts. The counters stay over the full list.
- Lunch/Dinner headings appear only under the time sort.
- Desktop shows `aria-sort` on the active `columnheader`. The phone uses a select with 8 options.
- The testid registry was updated in the same diff, including the removed ids.

## Open Questions

- **Local Postgres from round 2 (pre_existing, ops, not a code finding).** 095 was edited in place. The hosted probe (`hosted-095-probe.log`) shows it applied on neither prod nor DEV, so hosted is fine. Any local Supabase stack that applied the round-2 095 still has a lot of leftovers, and `supabase migration up` will not re-run 095. The leftovers are:
  - `checkin_code` and `checkin_qr_path` and their indexes;
  - the `booking-checkin-qr` bucket;
  - the 13-arg `staff_create_booking`, the 5-arg `confirm_booking_change` and `forget_checkin_qr_paths`.

  Suggested action: run `supabase db reset` before the next local walk, and re-probe prod for the absence of `edit_version` immediately before applying 095 at release.
- **Unnamed tie-break (N1).** Should unnamed rows also sort last when they only tie on time? That is the owner's call. The spec is silent.

## Verdict: APPROVED

## Next Steps
- Optional: fix N1, either in the code or the comment. No re-review is needed for it.
- Release: apply 095 first, then deploy, per the r3 handoff.
