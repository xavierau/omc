---
id: reviews/2026-11-27-book-013-phone-optional-review
type: review
author: verifier
mode: re-review
created: 2026-11-27
status: active
supersedes: null
superseded_by: null
related: [specs/2026-11-26-book-013-staff-booking-crud, threats/2026-11-26-book-013-staff-booking-crud, artifacts/2026-11-27-book-013-phone-optional-handoff, artifacts/2026-11-27-book-013-phone-optional-r2-handoff, reviews/2026-11-26-book-013-r3-re-review, kanban:BOOK-013, pr:236]
---

# Code Review: BOOK-013 decision 9, phone optional for staff bookings (PR #236, 2f922d5b..d23316cc)

## Summary
This PR does three things. It makes the phone optional on staff bookings (migration 096 plus the app). It refuses a manual member link on a booking without a phone. It fixes nit N1 from the r3 review: unnamed rows now sort last in the name tie-break. I checked it against spec S8 (AC-26..AC-29), the AC-25 revision, and threat R7, R11, R13, R19 and R20.

`origin/feature/book-013-phone-optional` = `d23316cc`, the same as the brief, so no escalation is needed. Every finding below was checked at HEAD, not taken from the dev's notes.

I found no correctness bug on any send path, in the SQL, or in the tenant scoping. All findings are `nit`; none is `important`.

The touched test files pass: 9 files, 271 tests (`vitest run` on the nine changed test files, 2026-11-27 17:24). The scratch-DB evidence for 096 is `artifacts/evidence/2026-11-27-book-013-phone-optional/scratch-db-096.log`: 22 of 22 PASS.

Severity mapping: the brief's `important` is 🟡, and `nit` is 🟢. I found nothing that counts as 🔴.

## AC-2 verdicts (explicit)

| Check | Verdict | Evidence (HEAD) |
|---|---|---|
| Senders: staff confirmed / changed / cancelled | PASS | `staff-booking-shared.ts:90` `!notify \|\| !hasPhone(booking)` returns `'none'` before the throttle claim and the sender. Create, edit and cancel all go through `messageDiner`. `bookingMessageFor` is typed `BookingWithPhone`. |
| Decision (confirm / decline) | PASS | `decide-booking-request.ts:103` returns `delivered: null` with no `recordOutcome`. Test `book-013-decide-notify.test.ts` covers Notify both on and off. |
| Reminder cron | PASS | DB layer: 095 `booking_reminder_candidates` requires `notify_diner`, and 096 CHECK `phone IS NOT NULL OR notify_diner = false` keeps that false. App layer: `send-booking-reminders.ts:61` `filter(hasPhone)` runs before the claim. |
| `received` (booking page) and agent acknowledge / full reply | PASS | `submit-booking-request.ts:158` and `verify-agent-booking.ts:93` guard the send. `tellFull` / `acknowledge` / `linkExistingMember` are typed `BookingWithPhone`. `AgentBooking.phone: string` is backed by 096 CHECK `phone IS NOT NULL OR source = 'staff'`. |
| Every other `sender.send` / `sendText` site | PASS | `grep -rln "sender\.send\|sendText("` in `src/application` and `src/app` finds 11 files. The booking ones are all covered above. `recheck-agent-bookings` takes `AgentBooking`. `process-agent-reply` and `deliver-outbound-webhook` carry no booking phone. |
| Webhook and agent lookups by phone | PASS | `countPendingBookings`, `listUpcomingDinerBookings`, cancel-by-diner, `countLiveUnverified`, `findPromotable` and 092's `phone = p_phone` all use `.eq('phone', <sender>)`. A NULL never matches, so a phone-less row never shows up in a diner's or an agent's view. |
| 088 auto-link trigger and backfill | PASS | `088:150` `b.phone = NEW.phone` and `088:173` `m.phone = b.phone`: NULL never matches, so a new member never auto-links a phone-less booking. |
| PII purge | PASS | `booking-request-repository.ts:464-474` updates only `name`, `notes` and `pii_purged_at`. It never writes `phone`, so neither CHECK can trip. The 095 edit_version trigger compares with `IS DISTINCT FROM`, which is null-safe. |
| Logs and masking (R13) | PASS | `send-booking-message.ts:39` `maskPhone(null)` returns `'none'` and never throws. No staff-path log prints a phone. The route test asserts no `***` and no `null` in warn/error output for a phone-less create. |
| Member stats and member panel | PASS | `member_booking_stats` and `listMemberBookings` (`booking-member-repository.ts:73-82`) select by `member_id` and never read `phone`. A phone-less booking has `member_id` null on create (`create-staff-booking.ts:46`) and on clear (`edit-staff-booking.ts:66`). |
| Exports | PASS (n/a) | No bookings CSV or export exists in `src/app/api/dashboard/bookings` or `src/components/dashboard/bookings`. |
| UI consumers of `BookingItem.phone` (= `BookingRequest`) | PASS | `PhoneLink` (`booking-row.tsx:222`, used in the desktop table, the cards and the day panel), Today `NameCell`, the cancel dialog, the edit hint, `initialForm`, `matchesSearch` (`booking-groups.ts:43`) and `matchesTodaySearch` (`booking-checkin.ts:90`) are all null-safe. tsc is clean (`evidence/…-r2/tsc.log`, exit 0). The only casts of `phone as string` in `src` are on non-booking tables. |
| 096 CHECKs | PASS | `phone IS NOT NULL OR source = 'staff'` and `phone IS NOT NULL OR notify_diner = false` (`096:17-28`). Both are validated on ADD. Every existing row has a phone, so ADD succeeds with no row changed (scratch row 4). |
| `staff_update_booking` WHERE | PASS | `096:107` `(p_phone IS NOT NULL OR b.source = 'staff')`. The app already refuses first (`edit-staff-booking.ts:88`), before rules, the write or a send. Scratch rows 14-17: a non-staff clear changes 0 rows and writes no events row. |
| Notify forcing | PASS | Three layers. DB: `096:54` and `096:101` store `p_notify AND p_phone IS NOT NULL`. Server: `staff-booking-input.ts:125`. Client: `formBody`. Both functions keep 095's `LANGUAGE sql SET search_path = public, pg_temp` and stay non-SECURITY DEFINER, as in 095. |
| REVOKE / GRANT signatures | PASS | Byte-identical to `095:137-138` and `095:192-193`: create `(uuid, uuid, text, text, int, date, time, text, boolean, uuid, timestamptz, jsonb)`, update `(uuid, uuid, text, int, uuid, text, text, int, date, time, text, boolean, boolean, uuid, jsonb, jsonb)`. Because `CREATE OR REPLACE` keeps the same signature, there is no stray overload. Scratch rows 20-22 confirm this. |
| A diner channel cannot write a null phone | PASS | `bookingInsertRow` takes `NewBookingRequest.phone` from the token owner, the agent key or the webhook sender. These are all `string`, and the DB CHECK refuses the row anyway (scratch rows 8-12, including a raw UPDATE). 095 is unchanged (`git diff --stat` touches only 096). |
| Member link refuses a phone-less link inside the tenant-scoped query | PASS, with nit N-1 | `relink-booking-member.ts:49-50` runs the `phone_required` check on the row read by `findStaffBookingForRestaurant(id, restaurantId)` (`booking-member-repository.ts:24-31`, scoped by `id` AND `restaurant_id`, `STAFF_COLUMNS` includes `phone`). So another tenant's booking answers 404 before `phone_required` (route test). The refusal is not in the write's WHERE, though: see N-1. |

## 🔴 Critical (Must Fix)
None.

## 🟡 Important (Should Fix)
None.

## 🟢 Minor (Optional)

**N-1 (nit): a race can link a member to a booking without a phone.**
- **Where:** `src/application/booking/relink-booking-member.ts:50`, with `supabase/migrations/088_booking_member_backfill.sql:54-62`, which this PR does not change.
- **Problem:** the AC-26 `phone_required` refusal reads the phone, then writes. The `relink_booking_member` RPC's WHERE checks the expected `member_id` but not `phone`.
- **Failure scenario:** a staff booking has a phone and no member.
  1. Staff A taps Link member and `findBooking` reads the phone.
  2. Staff B saves an edit that clears the phone. The row is now phone null, member null, edit_version + 1.
  3. A's `relink` runs with `p_from_member_id = null`. The `member_id IS NOT DISTINCT FROM null` check still matches, so the link is written on a booking that now has no phone.
- **Risk:** low.
  - The link is staff-only (BOOK-008 R3) and decides no send.
  - The CHECK still keeps Notify off.
  - The next phone-less save drops the link, which is exactly what AC-26 meant to avoid.
  - No diner message and no data loss.
- **Fix (optional):** a later migration (not 095) re-creates `relink_booking_member` with `AND (p_to_member_id IS NULL OR b.phone IS NOT NULL)`. The app maps the empty result to `conflict`, as now. The dev already lists this under `unverified`. It is the owner's call whether it is worth a migration.
- **How to show it fails:** a scratch DB with two sessions. Session 1 runs `staff_update_booking(... p_phone => NULL ...)` on the row, then session 2 runs `relink_booking_member(id, r, NULL, m, actor)`. One row is returned, with phone NULL and member_id = m.

**N-2 (nit): a rolled-back app would break on phone-less rows.**
- **Where:** `supabase/migrations/096_booking_staff_phone_optional.sql:8-10`, the release note.
- **Problem:** the header covers the forward order (096 before the new code). It does not say that once a phone-less row exists, the old code can't run against it.
  - The old `matchesTodaySearch` calls `digitsOf(b.phone)` and throws on null whenever the Today search holds 4 or more digits.
  - The old `PhoneLink` renders `tel:null`.
  - Restoring NOT NULL fails while such rows exist.
- **Risk:** only if PR #236 is reverted after staff have used it. A forward deploy is unaffected.
- **Fix:** add one line to the release or rollback notes: "rolling back the app after phone-less staff bookings exist needs those rows given a phone or deleted first".
- **How to show it fails:** at 2f922d5b, call `matchesTodaySearch({ name: 'x', phone: null }, '9123')`. It throws a TypeError.

**N-3 (nit): whitespace-only names in the Today sort.**
- **Where:** `src/domain/services/booking-today-sort.ts:47-49`.
- **Problem:** for two unnamed rows (one with `name: null`, one with `'  '`), the comparator falls through to `collator.compare('  ', '')`. That orders the two unnamed rows against each other, by whitespace.
- **Risk:** cosmetic. The order among unnamed rows on the same time is arbitrary either way. Staff names are trimmed by `parseName`, so this can only come from a diner channel.
- **Fix:** optional. Compare `a.name?.trim() ?? ''`.

## ✅ Strengths
- **Three layers on every send path.** The type system enforces `BookingWithPhone` at the sender edge, `hasPhone` guards each use case, and the DB CHECKs (096) back both. Even a caller that bypasses the app cannot store Notify on without a phone, or a phone-less non-staff row.
- **N1 is fixed as the accepted AC-25 reading.** Under the Name key, unnamed rows are last in both directions (`unnamedLast` runs before the sign). Under every other key, only the ascending name tie-break puts unnamed rows last, so ordering across times is untouched. All six key/direction pairs are tested.
- **The fixed items hold.**
  - The name is still required: `parseName` is unchanged, and the route and domain tests cover it.
  - A phone added later sends only when `dinerNews(changed)` holds; `phone` is not in it (`edit-staff-booking.ts:56`, and the route test "adding a phone … no message goes").
  - Unlink stays allowed (`relink-booking-member.ts:50` only refuses a non-null `memberId`).
  - 095 is untouched.
- **The `phone_required` refusal is placed after the tenant-scoped lookup**, so it never tells another tenant that a booking exists.

## Open Questions
- **A reminder can follow a phone added later.** Adding a phone to a phone-less booking with Notify ticked (the AC-28 default) stores `notify_diner = true`. If no date, time or party size changed, no `changed` message is sent, as the owner chose. But the booking now qualifies for `booking_reminder_candidates`, so the diner gets the 3-hour reminder for a booking they never got a confirmation for. That follows from AC-2 and AC-6 (Notify on = reminder), so it is not a finding. It is a product call whether that is wanted, or whether Notify should start unticked when a phone is first added.
- **Pre-existing, not in range:** `purgeBookingPii` keeps `phone` on purged rows, so purge does not clear the booking phone. I note it only because "PII purge" was in scope for AC-2. This PR does not change it.

## Verdict: APPROVED

## Next Steps
- Merge per the owner's go (096 is applied after 095, before the new code restarts).
- Optional: N-1 as a follow-up migration; N-2 as a line in the release or rollback note. Neither needs a re-review.
