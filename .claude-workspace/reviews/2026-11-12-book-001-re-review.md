---
id: reviews/2026-11-12-book-001-re-review
type: review
author: verifier
mode: re-review
created: 2026-11-12
status: active
supersedes: reviews/2026-11-12-book-001-cross-model
superseded_by: null
related: [reviews/2026-11-12-book-001-cross-model, artifacts/2026-11-12-book-001-f1-handoff, threats/2026-11-12-restaurant-booking, kanban:BOOK-001]
---

# Code Review: BOOK-001 F1 fix round (PR #178, re-review round 1)

## Summary

- Scope: `feature/book-001` `16bcab64..d6ce14bb` (3 commits; code in `916a72f0`, 75 files, +1,224/−222). I read it read-only in `/Users/xavierau/Code/js/whatsapp-crm-BOOK-001-worktree`. Every line reference below is at HEAD `d6ce14bb`.
- **All 16 listed finding ids are closed.** That is S-1 to S-6, G-A1 and /code-review #1, #3, #4, #6, #7, #8, #9. Each was checked in the code, not taken from the handoff.
- **New findings on the F1 diff:** none Critical, one Important, one Minor.
  - **N-1 (Important):** the F12 in-place resubmit goes through `updateWhatsAppTemplate`. That path never auto-resolves the WABA id, so a booking-template draft created before the WABA was known never reaches Meta on later saves. Before F1, each save created the template again, and that create resolved the WABA.
  - **N-2 (Minor):** identifying Book now by path on any host reclassifies third-party dynamic URL buttons that end in `/b/{{1}}`.
- **New surfaces, read closely, no defect found** (details below): the `booking_reminder_candidates` SQL function, `requireAdminForBookingUrlChange`, the `book_now_token_missing` refusal with the `isBookNowButtonUrl` regex, the `listBookingRequests` merge, and `recordDecisionMessage`.
- Tests: I ran all 22 test files F1 touched, through a basename filter: 23 files and 309 tests passed. I did not re-run the DB test (it needs the scratch cluster). The dev's `f7-db-green.log` shows 15/15, and `f1-04-scratch-db.log` shows the grants and the retention index plan.

## Finding closure table (R2-01)

| Id | Finding | Result | Evidence (HEAD d6ce14bb) |
|---|---|---|---|
| S-1 | Book now found by exact `NEXT_PUBLIC_APP_URL` equality | **closed** | `src/domain/services/book-now-button.ts:25,37-43`: the regex `^https://<host>[/<prefix>]/b/{{1}}$` takes no `appUrl`. `send-template-message.ts:175-182` and `campaign-mode.ts:38-46`, `campaign-qr-only.ts:26-38`, `coupon-requirement.ts:40`, `campaign-book-now-check.ts:40` no longer read the env. The `appUrl` arguments are removed everywhere (grep: no `appBaseUrl` left in the send/guard path). Tests: `book-now-button.test.ts:34-40` (any host, prefix, and 8 negatives). The worker env no longer matters, so the startup assertion is moot |
| S-2 | Book now welcome campaign breaks the partner-API welcome | **closed** | Guard: `campaign-book-now.ts:35` (`welcome && (enabled \|\| templateHasButton)` → `welcome_not_supported`). Wired on POST `campaigns/route.ts:54` (`type: parsed.type`) and PATCH `[id]/route.ts:173,179` (a `type` change re-checks). Form: `campaign-book-now-form.ts:27-31`, `campaign-form-types.ts:218` (never sends Book now on for welcome), `campaign-book-now-fields.tsx:22-31`. Send-layer refusal: `send-template-message.ts:51-53`, before any media/Meta call |
| S-3 | Campaign `bookingUrl` writable by any member | **closed** | `book-now-guard.ts:41-48`, called on POST `route.ts:51` and PATCH `[id]/route.ts:116` before any write. 403 via `AuthError` → `campaign-error-response.ts` `handleError`. R14 amended in the threat model (line 153). The UI is read-only for non-admins: `campaign-book-now-fields.tsx:39,55-59`, flag from `settings/booking/route.ts:33` |
| S-4 | Reminder candidates starve due rows behind the limit | **closed** | `082_booking.sql:186-205`. The window, the created-at rule and `ORDER BY booking_date, booking_time, id` run in SQL. The repository is `booking-request-repository.ts:175-182` (rpc). The DB test seeds a flood of 24 never-due rows with the earliest start: `due(1)` returns the due row (`booking-cron.db.test.ts`, F7 block) |
| S-5 | A new draft row on every Simple save while submission fails | **closed, with a regression (N-1)** | `provision-booking-templates.ts:60-77`: a `failed` (draft) status resubmits in place, so no new row is created. Walk `f12-walk.log`: 8 rows after 3 saves. See N-1 for the path where in place never submits |
| S-6 | 410 `booking_unavailable` has no `state` | **closed** | `api/b/[token]/route.ts:26` `state: 'off'` → `booking-form-client.ts:25` → `booking-form.tsx:53` → `booking-unavailable.tsx:19,23,32` (off title/body, no "send BOOK" line) |
| G-A1 | No retention index | **closed** | `082_booking.sql:127-129` partial index `(booking_date) WHERE pii_purged_at IS NULL`. `f1-04-scratch-db.log`: Index Scan |
| #1 | Hidden settings fields block saving in Off/External | **closed** | `use-booking-settings.ts:53-70`: outside Simple an invalid lifetime or party size is omitted. The server keeps the stored value through `parseTtlField(raw, current…)`. The validators are shared (`booking-config.ts:64-66`, exported) |
| #3 | Chat link reused even when about to expire | **closed** | `booking-token.ts:37-49` (`≥ 1h` left, or no expiry); `booking-token-repository.ts:147,157-158` |
| #4 | Past time today accepted | **closed** | `booking-submission.ts:43-50,108-112,131`; `submit-booking-request.ts:113-115` (HK now). i18n `booking.errors.past_time` en/zh |
| #6 | Reminder copy says "today" | **closed** | `booking-templates.ts:31-36` and `booking-message.ts:57-58,67` state `{{date}}`; `buildBookingTemplateParams` already supplies `date` (`booking-message.ts:40`) |
| #7 | Decision delivery status lost on reload | **closed** | Column + CHECK `082:98-102`; `decide-booking-request.ts:60-68,80-83` (store failure logged, decision kept); `recordDecisionMessage` scoped by id + restaurant (`booking-request-repository.ts:159-167`); the list maps it (`:60`); badge at `booking-row.tsx:79` |
| #8 | List hides old pending requests | **closed** | `booking-request-repository.ts:104-125`: two queries, both `.eq('restaurant_id', restaurantId)`, pending with no limit + newest 200 decided, merged newest first. Route `bookings/route.ts:16` |
| #9 | = S-6 | **closed** | as S-6 |

## New-surface notes (no finding)

- **`booking_reminder_candidates` (082:186-205).**
  - Window ends: SQL `start > p_now AND start <= p_now + lead`. That equals `isReminderDue`'s `now ∈ [start − lead, start)` (`booking-reminder.ts:31-37`).
  - Created-at rule: `created_at <= start − lead`, which equals `createdAt <= opensAt`.
  - HK conversion: `(date + time) AT TIME ZONE 'Asia/Hong_Kong'` turns a local timestamp into a timestamptz. `p_now AT TIME ZONE …` gives the HK wall clock. `AT` binds tighter than binary `-`, so `… AT TIME ZONE 'Asia/Hong_Kong' - make_interval(...)` is correct.
  - Security matches 064/079: `LANGUAGE sql STABLE`, default SECURITY INVOKER, REVOKE from PUBLIC/anon/authenticated, GRANT to service_role.
  - The DB test covers both window ends, a 2.5 h booking, a window that crosses midnight, and the grants.
- **`requireAdminForBookingUrlChange`.**
  - It compares the parsed value, which is trimmed and blank → null, against the stored value. Stored values are trimmed when written, so a staff edit form that sends the stored URL back still saves.
  - Setting or clearing the URL needs admin. Toggling Book now stays open to staff, as R14 states.
  - Only these two routes write `booking_url`: grep finds `campaign-mapper.ts:96,127`, reached through the POST/PATCH routes. `seed-default-welcome-campaign.ts` passes no `bookingUrl`.
- **`book_now_token_missing`.**
  - Callers: `execute-campaign-send.ts:141,171` go through `withBookingToken`. `process-welcome-send-job.ts:198`, `prompt-marketing-optin.ts:84` and `booking-deps.ts:38` carry no token.
  - The refusal is typed and runs before any network call.
  - The regex blocks userinfo (`@` excluded from the host) and any query or fragment.
- **`listBookingRequests`.** Both queries are tenant-scoped. The merge compares PostgREST ISO timestamps with `localeCompare`. Those strings all use the same offset format, so the order is correct.
- **`recordDecisionMessage`.** It runs `UPDATE … WHERE id AND restaurant_id`, and a CHECK limits the value.

## 🔴 Critical (Must Fix)

None.

## 🟡 Important (Should Fix)

**N-1: An in-place resubmit of a booking-template draft never resolves the WABA id, so a draft created before the WABA was known stays a draft on every later save.**
- Where:
  - `src/application/booking/booking-template-deps.ts:23` sends drafts to `updateWhatsAppTemplate`.
  - `src/application/update-whatsapp-template.ts:63-77`: `getMetaBusinessAccountId` only. With a falsy WABA and no `metaTemplateId`, it saves locally and returns without submitting.
  - Compare `src/application/create-whatsapp-template.ts:67-68,82-93` (`getMetaBusinessAccountId(...) || await autoResolveWabaId(...)`, which also stores it).
- Problem: before F1, every Simple save re-created a failed template through `createWhatsAppTemplate`, and each create retried the WABA auto-resolution. F12 sends drafts down the update path instead, and that path has no auto-resolution.
- Failure scenario:
  1. A restaurant with `meta_business_account_id` unset (`''`/NULL) saves Simple booking before its WhatsApp number is linked, or while `resolveWabaId` fails transiently. `createWhatsAppTemplate` → `autoResolveWabaId` returns null, which leaves 8 `draft` rows with no error.
  2. The number is linked. Each later Simple save finds the 8 rows `failed` → `resubmitTemplate` → `updateWhatsAppTemplate` → falsy WABA → `updateTemplate(templateId, changes)`. Nothing goes to Meta and the status stays `failed`.
  3. The settings page keeps showing failed templates. Confirm/decline/reminder messages to diners outside the 24-hour window cannot use a template.
  4. It recovers only if some unrelated path stores the WABA: a manual template create, the contact-flow deploy, or the WA-templates "resubmit"/"resolve-waba" routes.
- Risk: a silent, permanent stall of booking messages for that tenant. It breaks the header promise in `provision-booking-templates.ts:12-13` ("the next save retries it").
- Fix (either):
  - (a) Resolve and store the WABA once at the top of `provisionBookingTemplatesFor`: reuse `autoResolveWabaId`'s logic and export it from `create-whatsapp-template.ts`, or move it to a shared helper. Do this before any resubmit.
  - (b) In `resubmitTemplate`, fall back to `createWhatsAppTemplate`'s WABA resolution when `getMetaBusinessAccountId` is falsy.
- How to show it fails: write a unit test on `provisionBookingTemplatesFor`, or on the real `updateWhatsAppTemplate`, with `getMetaBusinessAccountId → ''`, `getRestaurantPhoneNumberId → 'pn-1'`, `resolveWabaId → 'waba-1'`, and a stored `draft` booking template with `metaTemplateId: null`. Today `createMetaTemplate` is never called. Before F1 the same setup called it with `waba-1`. The F12 walk (`f12-walk.log`) used a failing provider throughout and never saw a recovery.

## 🟢 Minor (Optional)

**N-2: Identifying Book now by path on any host takes over third-party dynamic URL buttons that end in `/b/{{1}}`.**
- Where: `src/domain/services/book-now-button.ts:25,37-43`, `src/components/dashboard/wa-template-form-types.ts:178`.
- Problem: the F3 ruling ("any host") recognises a URL button such as `https://partner.example/b/{{1}}` as Book now. The dashboard builder writes coupon buttons as `/coupon/{{1}}`, so such a button can only come from a template authored in Meta and synced in, or from a hand-typed custom URL.
- Failure scenario: a tenant's synced template has a dynamic URL button `https://<their-site>/b/{{1}}` and is used on a coupon campaign.
  - Saving the campaign returns 400 `toggle_off_with_button`.
  - An existing campaign on that template gets `book_now_token_missing` for every recipient (`send-template-message.ts:51-53`).
  - Opening the template in the builder rewrites the URL to `${APP_URL}/b/{{1}}` on save (`wa-template-form-types.ts:178` maps it to `BOOK_NOW_URL`).
- Fix (only if wanted): anchor the host to the app's own host family, or store an explicit Book now marker on the button. Alternatively, record in the plan that `/b/{{1}}` on any host is reserved. Likelihood is low, which is why this is Minor.
- How to show it fails: `isCouponUrlButton({type:'URL', url:'https://partner.example/b/{{1}}'})` returns false, and `templateHasBookNowButton` returns true.

## ✅ Strengths

- **One identity rule.** Book now identity is one pure predicate shared by the form, the guard, the coupon predicates and the sender. Removing the `appUrl` arguments got rid of the drift surface rather than patching it.
- **Typed, early refusal.** `book_now_token_missing` is a typed `SendResult` that fires before media minting or Meta. A missed caller therefore fails with a named reason, not an opaque Meta 4xx (memory: principle_error_names_deciding_system).
- **SQL matches the domain.** The reminder SQL matches `isReminderDue` exactly. The worker keeps the JS re-check and the conditional claim, and the DB test seeds the exact flood that S-4 described.
- **Store failure never fails the decision.** If storing the decision-message status fails, the decision still succeeds. The response still returns the computed status.
- **Admin gate keeps staff edits working.** The gate treats "same as stored" as no change, so staff can still edit other campaign fields without being blocked.

## Open Questions

1. **Pending list size.** The pending list in `listBookingRequests` has no limit (`booking-request-repository.ts:107-112`). R11 caps pending at 3 per phone, not per restaurant, so a tenant with a large campaign could exceed the plan's "200 rows ≤ 500 ms" budget. The walk measured 203 rows in 67 ms. Is a per-restaurant ceiling wanted, or is this accepted for the POC?
2. **Opt-in prompt result ignored (pre-existing, from the dev's review_focus).** `prompt-marketing-optin.ts:84` ignores the send result, so a `book_now_token_missing` there would still record the prompt as sent. The opt-in template has no Book now URL button, so this is unreachable today. I did not raise it as a finding because the code F1 touched is the sender, not this caller.
3. **Welcome-job retries.** `process-welcome-send-job.ts` treats `book_now_token_missing` like any failure: it throws, retries until the final attempt, then sends an ops alert. This can only happen when an active welcome campaign's template gains a Book now button after the campaign was saved. Should the refusal be marked non-retryable?
4. **Admin URL field read-only on GET failure.** `canEditBookingUrl` falls back to read-only when the settings GET fails (`use-booking-availability.ts:44`). An admin then can't edit the campaign URL until a reload. This is conservative; noted only.

## Verdict: CONDITIONAL

On the brief's scale: **APPROVE_WITH_FIXES**. No 🔴 is open, and every listed finding is closed. One new 🟡 (N-1) is a regression introduced by the F12 fix.

Condition:
1. N-1: the booking-template retry path resolves the WABA (fix a or b) and has a unit test for the unset-WABA draft. Alternatively, the main thread records an accepted-risk ruling.

N-2 is optional.

## Next Steps

- Main thread: route N-1, plus N-2 if wanted, to one cold `dev` fix item. Then run a round-2 re-review limited to that diff. Under the re-review cap, a finding that survives round 2 goes to the plan.
- Main thread decides the Open Questions (1 and 3 especially).
- Not done here, because they are outside `files_allowed`: the `INDEX.md` entry for this review, and setting `status: superseded` on `reviews/2026-11-12-book-001-cross-model`. Owner: main.
