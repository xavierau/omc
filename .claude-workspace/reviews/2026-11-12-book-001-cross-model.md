---
id: reviews/2026-11-12-book-001-cross-model
type: review
author: verifier
mode: cross-model
reviewer_model: gemini-cli (2 slices) + claude substitute (grok lane down)
created: 2026-11-12
status: active
supersedes: null
superseded_by: null
related: [specs/2026-11-12-restaurant-booking, threats/2026-11-12-restaurant-booking, plans/2026-11-12-restaurant-booking, artifacts/2026-11-12-book-001-i1-handoff, artifacts/2026-11-12-book-001-w1-handoff, artifacts/2026-11-12-book-001-w2-handoff, artifacts/2026-11-12-book-001-w3-handoff, kanban:BOOK-001]
---

# Code Review (cross-model): BOOK-001 restaurant booking, PR #178

Gemini: CONDITIONAL (slice A: public booking + data layer) · CONDITIONAL (slice B: webhook + campaign send + templates)
Grok: FAILED: `grok --single` exit 1, "Error: Not signed in" (account-level auth). Replaced by a Claude substitute lane (memory `incident_review_cli_billing_exhausted`).
Merged verdict (worst-of): **CONDITIONAL**, which is **APPROVE_WITH_FIXES** on the brief's scale.

## Summary

Gate ran with Gemini plus a Claude substitute: grok failed because it is not signed in (`grok login` needed). Grok's independent lens is missing from this gate.

- Scope: `feature/book-001` HEAD `16bcab64` against base `329cabd1` (156 files, +9,918/−61). Reviewed read-only in `/Users/xavierau/Code/js/whatsapp-crm-BOOK-001-worktree`.
- Probes: each CLI got a one-line prompt first. Gemini answered "OK." (exit 0). Grok exited 1 with "Not signed in".
- How the diff was split:
  - Gemini A: migration 082, `/b/**`, `/api/b`, submit/resolve/decide/purge/reminders, the booking repositories, the dashboard bookings and settings API, and the booking UI.
  - Gemini B: the webhook hook, the BOOK keyword, the Decisions client, classification storage, the campaign send with Book now, per-button URL params, the coupon predicates, template provisioning, and the campaigns API.
  - The Claude substitute lane read the brief's priority surfaces across both slices and built the R1–R21 table.
- Run notes:
  - Both Gemini runs used `--approval-mode plan` and exited 0. Each ran for several minutes; the skill's 2-minute cutoff is meant for hangs and was not applied to a 9.9k-line review.
  - Both runs logged one refused `invoke_agent` call (plan mode blocks scripts) and kept going. Run A also logged one `read_file: File not found`.
- No finding is CRITICAL after verification. Gemini B's one Critical is about code that existed before this PR, so it is not a BOOK-001 defect (triage below).
- Every R-id R1–R21 is enforced in code. Two have recorded gaps (R13, R19) and R20 is a checklist item; see the table.
- Three Important findings remain:
  - **S-1**: the Book now button is found by an exact URL match on `NEXT_PUBLIC_APP_URL` at send time.
  - **S-2**: a Book now welcome campaign breaks the partner-API welcome send.
  - **S-3**: any tenant member can set the campaign booking URL. This is a gap in the threat model, not in the code.

## R1–R21 enforcement table (R1-02)

| R | Status | Where (HEAD 16bcab64) | Note |
|---|---|---|---|
| R1 | enforced | `booking-token-repository.ts:22-24` (randomBytes(32) base64url), `:100-119` (UPDATE … `consumed_at IS NULL` + `.or(expires_at.is.null,expires_at.gt.now)`); PK `082_booking.sql:46-47`; `booking_requests.token UNIQUE` `:96` | A claim is released only when the same caller's insert fails (`:122-134`, `submit-booking-request.ts:85-88`) |
| R2 | enforced | `submit-booking-request.ts:80-84` (restaurant/phone from `claim.owner`); `booking-submission.ts:30,97` (identity fields ignored); `api/b/[token]/route.ts:35-48` (no query or body identity read) | |
| R3 | enforced | `booking-submission.ts:51-106` (date ≥ HK today, HH:MM, party 1..max, name ≤60, notes ≤500, unknown fields → error); DB CHECKs `082:83-87`; no `dangerouslySetInnerHTML` (test `src/app/b/__tests__/booking-page.test.tsx:128-139`) | A hand-written parser, not zod; meets the rule. No upper bound on the date (S-7) |
| R4 | enforced | `booking-request-repository.ts:120-137` (`eq id, restaurant_id, status='pending'`); `decide-booking-request.ts:63` (sends only when a row changed) | |
| R5 | enforced | `booking-request-repository.ts:124-129` (`decided_by`, `decided_at`); `decision-response.ts:28-31` (userId from the tenant context) | |
| R6 | enforced | `bookings/route.ts:14-15`, `bookings/[id]/route.ts:11-13`, `decision-response.ts:28-31` → repo `:96-137`, each `.eq('restaurant_id', …)` in the query itself | Follows the authorize-by-scoped-query principle |
| R7 | enforced (prod 307 unverified) | `booking-security-headers.ts:7-24`; `next.config.ts:13-15`; `api/b/[token]/route.ts:14,20`; `page.tsx:17-21` (robots noindex, referrer no-referrer); fonts via `next/font` (self-hosted) | I1: the dev server answered the `/b` 307 with `no-cache`, not `no-store`. The prod `next start` header was not checked |
| R8 | enforced | masked phone at `submit-booking-request.ts:53,86`, `send-booking-message.ts:28-33,73`, kapso client (`fbdec552`); `route-booking-intent.ts:58,72` logs messageId and outcome only; `decisions-client.ts` logs nothing | |
| R9 | enforced | `decisions-client.ts:53-61` (body = model + truncated text + question); key in the `x-goog-api-key` header `:108` | |
| R10 | enforced | `resolve-booking-link.ts:51-53,91` | |
| R11 | enforced (accepted races) | per-IP 10/min `submit-booking-request.ts:32,56-64` (fails open if the limiter is down); pending cap 3 at `:114-116`; chat link reuse at `resolve-booking-reply-target.ts:49-56` | Check-then-insert cap race and concurrent-BOOK double mint, accepted for the POC (W1/W2) |
| R12 | enforced | `booking-intent.ts:15-24` (1,000 chars), `decisions-client.ts:27,103-117` (2 s abort, never throws), `route-booking-intent.ts:56-73` + `booking-intent.ts:26-30` (error/low confidence → fallback) | |
| R13 | partially | `route-booking-intent.ts:48-74`: the label only selects a reply. It also mints a chat token (`:60` → `resolve-booking-reply-target.ts:52`) | The threat-model test reads "no repository writes other than the R17 record". The token mint is a second write; it is documented in code and grants no benefit (S-8) |
| R14 | enforced as written | `settings/booking/route.ts:53-54` (`requireTenantAdmin` before any read/write); `booking-config.ts:54-62` (https, host, no credentials, ≤2048); campaign URL `campaign-book-now.ts:47-53` + DB CHECK `082:158-160` | Campaign `bookingUrl` is validated but not role-gated (S-3) |
| R15 | enforced | `page.tsx:23-27` never reads searchParams; `resolve-booking-link.ts:71-74` (target from the stored campaign URL, scoped by restaurant, else the default); `booking-config-repository.ts:77-92` re-validates https on read | I1 checked `?url=` / `?next=` live |
| R16 | enforced | `booking-message.ts:28-46` (control chars/whitespace collapsed, name ≤60, other params ≤200); notes never a parameter (`:37-46`, `booking-templates.ts` bodies) | |
| R17 | enforced | `082:133-143` (no text column, UNIQUE restaurant+message); `inbound-classification-repository.ts:18-36`; `route-booking-intent.ts:63-69` | |
| R18 | enforced | `collection-statement.tsx:9-26` (zh-HK + en, privacy link), rendered with the form at `booking-page-view.tsx:46` | `ohmyclient.io/privacy` not confirmed to exist (W1 unverified) |
| R19 | enforced in code; deploy pending | `booking-reminder.ts:45-49` (cutoff = HK today − 180 d), `booking-request-repository.ts:173-183`, `purge-booking-pii.ts`, `api/cron/booking-retention`, `scripts/cron/booking-retention.sh`, `deploy/README.md:312+` | The Forge Scheduled Job is not created yet (W3 unverified), so purging stays inert until then |
| R20 | enforced (checklist) | `.gitignore` `scripts/eval/data/`; only the synthetic `scripts/eval/fixtures/booking-intent-synthetic.csv` is tracked | Deleting the eval data afterwards is an owner checklist item |
| R21 | enforced | `submit-booking-request.ts:80` looks up a member only and never creates one or writes consent; templates are BODY-only UTILITY with no links (`booking-templates.ts`) | Meta categorization is unverified (owner) |

## 🔴 Critical (Must Fix)

None after verification. Gemini B's Critical is refuted for this PR; see the Gemini CLI section.

## 🟡 Important (Should Fix)

**S-1: The Book now button is found by exact URL equality on `NEXT_PUBLIC_APP_URL` at send time.** (substitute lane)
- Where: `src/domain/services/book-now-button.ts:31-37`, `src/application/send-template-message.ts:163-170`, `src/infrastructure/config/app-url.ts:7-9`.
- Problem: the button is identified only when `btn.url === trim(appBaseUrl()) + '/b/{{1}}'`.
  - The dashboard bundle inlines the URL when the template is built (`wa-template-form-types.ts`).
  - The campaign worker (`npx tsx scripts/start-worker.ts`, `deploy/README.md:209`) reads `process.env` at runtime.
  - Before this PR the worker never depended on `NEXT_PUBLIC_APP_URL`.
- Failure scenario: the worker's value is unset or differs from the one baked into the template (`''`, http vs https, an old domain after a move). Then `isBookNowButton` is false and the Book now button counts as a coupon button:
  - **Coupon + Book now campaign:** the Book now `{{1}}` is filled with the coupon code. The diner taps it, lands on `/b/<couponcode>` and sees "unknown link". The token minted at `execute-campaign-send.ts:121-130` is never used.
  - **Book now only, no coupon config:** `coupon-requirement.ts:42` blocks the campaign as "coupon config missing", which names the wrong cause.
- Fix:
  - Identify the button by its path, not the full URL: the URL ends with `/b/{{1}}` on any https host, or store an explicit Book now marker on the template button.
  - Add a startup assertion that the worker has `NEXT_PUBLIC_APP_URL`.
- How to show it fails: in `send-template-message` tests, unset `NEXT_PUBLIC_APP_URL` (or set a different host) while the template's button URL is `https://app.example/b/{{1}}`. The button params then carry the coupon code at the Book now index.
- Unverified: the prod worker's env. The I1 walk set it through `tools/env.sh` and never saw the button param on the wire.

**S-2: A Book now welcome campaign sends a template whose Book now button has no parameter on the partner-API welcome path.** (substitute lane)
- Where: `src/app/api/dashboard/campaigns/book-now-guard.ts:36-43` with `src/application/process-welcome-send-job.ts:197-207`.
- Problem: the guard accepts `bookNowEnabled` for every campaign type (`parse-create-body.ts:14` allows `welcome`). Only `execute-campaign.ts:213` builds a `bookNow` context. `process-welcome-send-job.ts` calls `sendWhatsAppTemplateMessage` with `couponCode` only, so `urlButtonValue` returns `undefined` for the Book now button and the button gets no parameter.
- Failure scenario: an admin creates a welcome campaign on a template with a Book now button and turns Book now on. That passes the guard. Each partner-API member create then sends the template with the dynamic Book now button unfilled, and Meta rejects it (missing URL button parameter). Every welcome for that tenant fails.
- Fix: refuse `bookNowEnabled` (and a Book now template) for `type: 'welcome'` in `assertCampaignBookNow`, or mint a token in the welcome send path.
- How to show it fails: a unit test on `buildButtonParams` with a Book now template and no `bookingToken` returns no entry at that button's index. The guard test then accepts `{ type: 'welcome', bookNowEnabled: true }`.

**S-3: The campaign `bookingUrl`, which every recipient is redirected to in External mode, is writable by any tenant member. This gap is in the threat model, not the code.** (substitute lane)
- Where: `src/app/api/dashboard/campaigns/route.ts:43-55` and `src/app/api/dashboard/campaigns/[id]/route.ts:114-116` call only `getTenantContext()`, with no `requireTenantAdmin`.
- Problem: R14 makes the restaurant's external URL admin-only because "staff must not … point it at a phishing page" (`settings/booking/route.ts:4-6`). For the campaign URL, R14 only requires "the same validation".
- Failure scenario: a non-admin member sets `bookingUrl: https://phish.example` with `bookNowEnabled: true` on a campaign in External mode. Each recipient's Book now link then 307s to that host (`resolve-booking-link.ts:71-74`).
- Fix: either gate `bookingUrl` and `bookNowEnabled` writes with `requireTenantAdmin`, or record in the threat model that staff may already send arbitrary URLs through campaign templates, so this adds no new capability. The decision belongs to the threat model owner.
- How to show it fails: a route test calls the campaigns POST as a `staff` role with `bookingUrl` and gets 201.

## 🟢 Minor (Optional)

**S-4: The reminder candidate query can starve due rows at scale.**
- Where: `booking-request-repository.ts:143-156` and `send-booking-reminders.ts:14,56-60`.
- Problem: the query is platform-wide with `limit 500` and is ordered by `booking_date` only. It also returns rows that will never be due (booked less than 3 h ahead) and are never claimed. Past 500 confirmed bookings in the today/tomorrow window, the due rows can fall past the limit (memory: principle_backstop_only_repairs_what_it_selects).
- Fix: order by `booking_date, booking_time` and filter the start window in SQL.
- Not a risk at pilot scale.

**S-5: Template provisioning leaves a new draft row on every Simple save while submissions fail.**
- Where: `provision-booking-templates.ts:50-59` and `booking-templates.ts:72-74`.
- Problem: a `draft` (failed) template is submitted again under a new name. When Kapso is down or has no key, each Simple save leaves 8 new draft rows in the restaurant's WA Templates list (I1 saw 8 `failed` statuses).
- Fix: resubmit the existing draft row, or delete the superseded draft.

**S-6: `booking_unavailable` (410) carries no `state`.**
- Where: `api/b/[token]/route.ts:24-25` and `booking-form-client.ts:25`.
- Problem: when the mode is switched off while the diner's form is open, submitting shows the "unknown link" copy instead of the "booking off" copy.
- Fix: return `state: 'off'` with the 410.

**S-7: The booking date has no upper bound, and today with a time already past is accepted.**
- Where: `booking-submission.ts:51-62`.
- Problem: `9999-12-31` is stored. The spec only requires date ≥ today, so this conforms; it is noted for the owner.

**S-8: R13's literal test is not met.**
- Where: `route-booking-intent.ts:60`.
- Problem: the classifier path also writes a `booking_tokens` row (simple mode). This is deliberate and documented in the code's own header, but the threat model's test says "no repository writes other than the R17 record".
- Fix: amend the R13 test text in the threat model, or mint the token lazily.

**S-9: A pre-existing gap in the Kapso client log masking was fixed inside this PR.**
- Where: `kapso/client.ts`, commit `fbdec552`.
- This is fine. It is noted because it changes a shared file outside the booking slice.

**S-10: AC-3 deviation, already flagged by I1-10.**
- In mode Off, `BOOK` / `訂位` from a non-member no longer reaches the opt-in prompt, because it is now a system keyword. Before this PR it was "unknown" text.

**G-A1 (Gemini A, verified, downgraded from Important): there is no index for the retention purge.**
- Where: `082_booking.sql`.
- The purge query (`lt booking_date`, `pii_purged_at IS NULL`) does a sequential scan. It runs once a day on a per-booking table, so the cost is small. "Will eventually time out" is not supported at any plausible size.
- Optional fix: a partial index on `(booking_date) WHERE pii_purged_at IS NULL`.

## ✅ Strengths

- The single-use claim is one conditional UPDATE with expiry re-checked at claim time, and `booking_requests.token UNIQUE` backs it up. A failed insert releases only the caller's own claim (`eq consumed_at = claimedAt`).
- Every dashboard booking query carries `restaurant_id` from the session inside the query. The decline/confirm loser is told apart from a foreign id only by a second scoped read, so another tenant's id gets 404.
- The classifier hook sits only on `route === null` after the receipt and opt-in checks. Gated or disabled routes go straight to `handleUnknown`, so AC-8 holds.
- The Decisions client never throws, uses a hard 2 s abort, sends a minimal body, and keeps the key in a header.
- `booking_config` stays out of `RESTAURANT_COLUMNS` (`booking-config-repository.ts:4-8`). `bookNowInsertColumns` keeps campaign creation working before migration 082 is applied.
- Readers fail to mode off, and the booking message sender never throws, so the booking state stays saved and staff see "not delivered" instead of a 500.

## Open Questions

1. Is the prod `ohmyclient-worker` environment guaranteed to carry `NEXT_PUBLIC_APP_URL` with the same value the dashboard build inlined (S-1)?
2. Should non-admin staff be able to set a campaign `bookingUrl` (S-3)?
3. Should Book now be allowed on `welcome` campaigns at all (S-2)?
4. Gemini A asked whether `notifyReceived` should block the submit response. It does today: the page shows "Request sent" either way, and the diner-facing response only reports `delivered`. A queue is out of POC scope.
5. Gemini B's Critical is about pre-existing code: `customer_name: member.name` is sent unsanitized in campaign template params (base `329cabd1` `execute-campaign-send.ts:121,148`). It is out of BOOK-001 scope; is it worth a separate kanban item?

## Gemini CLI

Raw responses are transcribed below with no edits. Each finding is followed by one `Verifier triage` line, added because the brief requires every finding to be verified.

### Slice A: public booking, dashboard, data layer (Verdict: CONDITIONAL)

#### Summary
The BOOK-001 PR provides a complete, robust implementation of the multi-tenant restaurant booking feature. It correctly enforces atomic token claims, avoids PII logs, uses conditional transitions to prevent race conditions during staff decisioning, and validates input at the boundary. However, there are two issues to address: a missing database index for the daily retention cron which will degrade performance over time, and a clean architecture violation in the settings setup page.

#### Critical (Must Fix)
None.

#### Important (Should Fix)
- **`supabase/migrations/082_booking.sql`:86** (PERFORMANCE — Missing Index)
  - **Problem:** The daily retention cron (`purgeBookingPii` in `src/infrastructure/supabase/repositories/booking-request-repository.ts`) queries `booking_requests` using `.lt('booking_date', beforeDate).is('pii_purged_at', null)`. There is no index covering `booking_date` or `pii_purged_at` without restrictive `WHERE` clauses (the existing reminder index filters by `status = 'confirmed'`).
  - **Risk:** As the `booking_requests` table grows, the retention cron will perform a full table scan on every run. This will consume excessive database resources and eventually time out.
  - **Fix:** Add a partial index to `082_booking.sql` optimized for the retention cron: `CREATE INDEX booking_requests_retention_idx ON booking_requests (booking_date) WHERE pii_purged_at IS NULL;`
  - Verifier triage: **confirmed, downgraded to Minor** (G-A1). A once-a-day scan; the timeout claim is not supported.
- **`src/app/dashboard/setup/page.tsx`:12** (ARCHITECTURE — Layer Separation)
  - **Problem:** The UI layer directly imports and calls `getBookingConfig` from `src/infrastructure/supabase/repositories/booking-config-repository.ts`.
  - **Risk:** Bypassing the Application/Domain layer couples the Presentation layer directly to the Infrastructure layer, violating Clean Architecture layer separation principles.
  - **Fix:** Provide a reader via the Application layer (e.g., through a dependency injection module or an application service like `readBookingSettings`) and use it in the page component instead of importing the repository directly.
  - Verifier triage: **refuted under the scoping rule.** The same page already imports `createServerSupabaseClient` and queries `restaurants` directly at base `329cabd1` (lines 10, 18-21), so the change matches the file's current style.

#### Minor (Optional)
None.

#### Strengths
- **Security (R1, R4):** The atomic claim logic (`consumed_at IS NULL AND (expires_at IS NULL OR expires_at > now())`) for tokens and the conditional transition logic (`status = 'pending'`) for booking decisions effectively prevent race conditions at the database level.
- **Resilience (R11, R12):** The IP rate limiter fails open on Redis outages, relying on the token capabilities and pending caps to bound abuse. The Gemini Decisions API client correctly implements a hard 2-second timeout using an `AbortController`.
- **Domain Modeling:** Robust use of Result types (`SubmitBookingResult`, `ParseBookingSettingsResult`) to avoid throwing errors for control flow, handling edge cases gracefully and predictably.
- **Completeness:** All aspects of the Integration Map, from `next.config.ts` security headers to campaign template provisioning and webhook routing (`book-handler.ts`), are fully wired.

#### Open Questions
- In `src/application/booking/submit-booking-request.ts`, `notifyReceived` blocks the response to the frontend until the WhatsApp message is sent to the diner. Was this intended to guarantee the frontend UI can immediately display a "not delivered" warning, or should the message dispatch be deferred to a background queue to improve perceived UI performance?

#### Verdict: CONDITIONAL

### Slice B: webhook classifier, campaign send, templates (Verdict: CONDITIONAL)

#### Summary
A comprehensive review of the BOOK-001 W2 and W3 architecture changes targeting the intent classifier, campaign sends, and template provisioning. The implementation effectively fulfills the threat model requirements for fallback safety, payload minimization to Gemini, and preventing PII in logs. However, one Critical issue was found regarding missing sanitization of the `member.name` parameter during template sends, which violates R16 and poses a risk to template deliverability.

#### Critical (Must Fix)
- **`src/application/execute-campaign-send.ts:114` (in `sendViaTemplate`)**
  - **Problem:** `member.name` is passed raw to the `customer_name` template parameter (`customer_name: member.name ?? 'there'`). The threat model (R16) explicitly dictates that template parameters must be "stripped of newlines/tabs, name capped 60".
  - **Risk:** A member with a name exceeding 60 characters or containing newlines/tabs will cause the Meta API to reject the template send, resulting in a dropped campaign message for that recipient.
  - **Fix:** Apply a sanitization function to `member.name` (e.g., `text.replace(/[\r\n\t]/g, '').slice(0, 60)`) before assigning it to the `customer_name` parameter.
  - Verifier triage: **refuted as a BOOK-001 finding.** `customer_name: member.name ?? 'there'` exists unchanged at base `329cabd1` (`execute-campaign-send.ts:121,148`). R16 covers diner-entered booking values, and those are sanitized in `booking-message.ts:28-46`. Moved to Open Question 5.

#### Important (Should Fix)
- **`src/app/api/webhooks/whatsapp/handlers.ts:114` (in `dispatchBook`)**
  - **Problem:** When the booking feature is disabled (`outcome === 'off'`), the `dispatchBook` handler falls through to `dispatchConfirmation(ctx, null)`. This in turn triggers `maybeReplyToBookingIntent(ctx)`, which queries the database for `bookingConfig` a second time before realizing the feature is off and eventually skipping the classifier.
  - **Risk:** Performs redundant database queries for `bookingConfig` on the webhook processing path when a user explicitly types "BOOK" but the feature is off.
  - **Fix:** Since the explicit `BOOK` intent was already matched and resolved to `'off'`, bypass `dispatchConfirmation` entirely and directly `return handleUnknown(ctx.phoneNumberId, ctx.phone, ctx.restaurantId)`.
  - Verifier triage: **refuted as Important.** The extra `booking_config` read is real, but the fall-through is deliberate: `handlers.ts:203-206` sends literal `BOOK` through `handleReceiptConfirmation` first, so mode Off behaves as before (AC-3). The proposed fix would skip that receipt check. At most Minor (one indexed PK read).

#### Minor (Optional)
- None identified. The codebase adheres strictly to the DDD boundaries and expected patterns.

#### Strengths
- **Secure Fallback Design:** The intent classifier gracefully degrades to the standard fallback on HTTP timeouts or Google safety blocklist errors, ensuring messages are never stalled and fail open (R12).
- **Data Minimization:** `truncateForClassifier` cleanly adheres to R9 and R12 by guaranteeing only <= 1000 characters of text (carefully preserving surrogate pairs) leave the system.
- **Button Parameter Routing:** The separation logic in `buildUrlButtonParams` robustly distributes dynamic parameters, ensuring the Book now token and coupon code perfectly coexist and never collide.
  - Verifier triage: true only while the worker's `NEXT_PUBLIC_APP_URL` matches the template's URL; see S-1.

#### Open Questions
- None.

#### Verdict: CONDITIONAL

## Grok CLI

FAILED, account level. Probe `grok --single "Reply with the single word OK." --permission-mode plan` exited 1 with: `Error: Not signed in. To authenticate without a browser, run: grok login --device-code`. No Grok review exists. The S-* findings above come from the Claude substitute lane, which read the same priority surfaces read-only (scope as `review-modes` principle 2).

## Verdict: CONDITIONAL

Brief scale: **APPROVE_WITH_FIXES**. There is no open 🔴.

Conditions:
1. S-1: identify the Book now button in a way that cannot drift, or prove the prod worker env has the matching `NEXT_PUBLIC_APP_URL`.
2. S-2: refuse Book now on welcome campaigns, or support it there.
3. S-3: the threat model owner decides on the role gate for campaign `bookingUrl`.

## Next Steps

- Main thread: route S-1 and S-2 to one `dev` fix item. S-3 is a threat-model ruling (main thread or owner).
- Deploy checklist items still open (from W/I1 handoffs): Forge jobs `booking-reminders` and `booking-retention`, Gemini paid tier, privacy policy text, the eval gate before `aiRoutingEnabled`, and a prod check that the `/b` 307 sends `Cache-Control: no-store`.
- Grok lane: run `grok login --device-code` before the next cross-model gate.
- INDEX.md was not updated: only this file is in `files_allowed` (owner: main).
