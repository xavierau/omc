---
id: reviews/2026-11-05-camp-014-re-review
type: review
author: verifier
mode: re-review
created: 2026-11-05
status: active
supersedes: reviews/2026-11-05-camp-014-absence
superseded_by: null
related: [reviews/2026-11-05-camp-014-absence, artifacts/2026-11-05-camp-014-dev-round2-handoff, plans/2026-11-05-camp-014-failed-campaign-remedy, investigations/2026-11-05-bicho-campaign-131042-wrong-reason, kanban:CAMP-014]
---

# Code Review: CAMP-014 round 2 re-review (1a9e1da5..3c6b8518)

## Summary

Every prior finding is closed or narrowed as specified, and the re-send order, lease and revert logic hold. Bicho's campaign is offered a re-run and accepted, with no double-send path.

One blocker remains, in the same class as C1. The guard refuses a failed body row with a null `error_code`, but the orphan sweep marks unknown-delivery rows `failed` with `error_code='internal_orphan'`. That row passes the guard and is not in the ledger, so the member is sent again. I ran this end to end with the real pipeline, sweep, guard and ledger code, and the member got a second send.

This does not reopen the route-guard ruling. It widens the guard's predicate by one value, but the ruling's wording ("null error_code") has to change, so it goes to the main thread.

One important new finding: Bicho's card still shows the wrong cause ("no billing currency") after release, because stored reasons are not rewritten.

Checked at `3c6b8518` by reading the code and running tests. The tree is unchanged (`git status` empty). Not run: browser, live Meta, or any prod query. The brief gave no prod read, so the prod shapes in AC-3 are traced from code.

A correction to the prior review: its AC-2 said the ledger holds for `errored` members ("every `errored` member is already safe while tracking is on"). That is true for only about 5 minutes. It missed the sweep.

## AC-1: prior findings and code-review items

| Item | State | Evidence and check |
|---|---|---|
| C1, the named scenario | **Closed; same class open as C2** | Ran `rerun-evidence-transport-failure.test.ts` (2 passed, inside a 9-file run of 157). With `sendTemplate` rejecting `TypeError('fetch failed')` through the real pipeline: rows are `failed` with null code, `rerunBlock` is null, the guard returns `delivery_unconfirmed` (test :175-192). `route.test.ts:254` pins 409 with no write. `markFailedNoBspId` never writes `error_code` (`whatsapp-message-repository.ts:112-127`), and these rows have no wamid, so no webhook can fill it later. The prior "second run sends nothing" step is replaced by the ruled refusal |
| I1 tracking off | Closed | `rerun-evidence-guard.ts:21`; `route.test.ts:226` |
| I2 errored run wording | Closed on the finalizer | `execute-campaign.ts:139-142`; `failCampaignRunIfSending` scope unchanged. The retract RPC (migration 064) still cannot see `errored`, as the prior review said. On its own that is wording only, but it is one of the routes into C2 |
| I3 failure after the CAS | Closed | `enqueue-revived-campaign.ts:15-22,37-49`; `route.test.ts:361-405`; refetch on any non-OK re-run at `campaign-card.tsx:43`; cards stay mounted at `page.tsx:27`. Residual in AC-2 |
| I4 QR warning blames Meta | Closed | `en.json:256`, `zh-HK.json:256` name no system |
| I5 list API time bound | **Narrowed, not closed** | Counts now run only for QR-only campaigns with counted sends, and templates are read only for coupon campaigns (`build-campaign-qr-states.ts:21-23,41-43`). No time budget was added: `with-qr-status.ts:34-42` still awaits with no timeout, so a hung read hangs the list. See M3 |
| I6 expired-coupon re-run | Closed | `rerun-evidence-guard.ts:27`, `coupon-campaign-queries.ts:39-52`; `route.test.ts:268`. `idx_coupons_campaign_id` exists (`005_campaign_coupon_link.sql:10`, never dropped), so the handoff's index concern is wrong in the good direction. Used-up coupons still skip, which is correct |
| I7 failed-card QR wording | Closed | `campaign-card-view.tsx:107`; `rerun-campaign-dialog.tsx:28`; `en.json:255`, `zh-HK.json:255` |
| M1 `{{couponCode}}` | Closed | `campaign-qr-only.ts:17,34` |
| Lost lease stranding | Closed | Unscheduled stamps and enqueues; scheduled leaves it to the cron (`enqueue-revived-campaign.ts:29-34`; `route.test.ts:324,338`) |
| Post-CAS failure compensation | Closed | As I3 |
| Expired-coupon re-run | Closed | As I6 |
| Tracking-off re-run | Closed | As I1 |
| QR count across runs | Closed within the ruled limits | `queued_at >= last_enqueued_at` when stamped (`whatsapp-message-campaign-queries.ts:73-75`). The list reads `select('*')`, so the stamp is present. `queued_at` is NOT NULL (`035:46`) |
| QR warning: wrong system, claim-flow images | Closed | Neutral wording; the count needs the QR-only flag, which is false for claim templates (`with-qr-status.ts:38`, `campaign-qr-only.ts:29`) |
| 131047 button | Closed | `campaign-rerun.ts:27`; card `campaign-card-view.tsx:63`; route :205. The phrase is in the 99c1f6b3 wording too, and `git log -S` shows it has been there since abe70cf0, so old stored reasons are refused |
| `{{couponCode}}` / COPY_CODE rule | Closed | The sender builds only URL and quick-reply button params (`send-template-message.ts:79-87`) and fills only `code`, so both correctly count as carrying no code |
| Count cost on coupon-less campaigns | Closed | As I5, first half |

## AC-2: re-send path at 3c6b8518

| Order | Step | Where |
|---|---|---|
| 1 | Block on the campaign's fields | `rerun/route.ts:61` |
| 2 | Evidence guard | `rerun/route.ts:66` |
| 3 | Gates | `rerun/route.ts:72` |
| 4 | CAS `failed -> active` | `rerun/route.ts:74` |
| 5 | Lease, or stamp on a lost lease if unscheduled | `enqueue-revived-campaign.ts:29-33` |
| 6 | Job, skipped on a lost lease if scheduled | `enqueue-revived-campaign.ts:31,34` |
| 7 | Revert on any error in 5 or 6 | `enqueue-revived-campaign.ts:19,37-49` |

| Check | Result |
|---|---|
| Double enqueue, lost lease with null `scheduled_at`, concurrent `/rerun` | Holds. The CAS admits one request; the loser gets 409 (`route.test.ts:309`). `getDueCampaigns` excludes null schedules (`campaign-repository.ts:374`), so no cron competes |
| Same, concurrent `/execute` | A second job is possible once the row is `active` (`execute/route.ts:28-41`, no lease). Not a double send: worker concurrency is 1 and its CAS needs `active` (`execute-campaign.ts:68`). The second job finds a terminal row, throws and exhausts, and `markCampaignFailed` only acts on `active`. Traced by reading |
| Revert against worker or cron | Holds. `restoreCampaignFailure` is a CAS on `active` (`campaign-repository.ts:330-347`), so a row in `sending` is never overwritten. If a cron job lands between revive and revert, the worker's CAS then refuses it. Traced by reading |
| Revert restores the right reason | Holds. It uses the row read before the revive (`enqueue-revived-campaign.ts:43`); `route.test.ts:361` |
| Guard on a query error | Holds. Each count throws on `error`; the route answers 500 with no write (`route.test.ts:292`) |
| Guard on a page-limited count | Holds. `count: 'exact', head: true` reads Content-Range, not rows. `count ?? 0` only sees null on an empty-body 404 (`postgrest-js PostgrestBuilder.ts:524`). The body-row count runs first on that table, reads 0 and refuses, so that failure closes |
| Guard predicate | **Fails: C2** |

Residuals, accepted as logged:
- A failed revert leaves the row `active` with no reason. With a past schedule the cron sends about 5 minutes after the tenant saw a 500. It is logged at error, and the refetch shows `active`.
- A lost lease with a future `scheduled_at` answers queued and waits for that time. It needs two re-runs within 5 minutes on a campaign that failed before its schedule.

## AC-3: real campaign shapes

**Bicho: 250 template rows failed 131042, 250 image rows failed 131047, 250 active coupons expiring 2027-01-03, `scheduled_at` and `last_enqueued_at` set.**

| Step | Outcome |
|---|---|
| Offered | Yes. The stored reason is the old currency wording (`99c1f6b3`), which matches neither refusal phrase |
| Guard | Passes. 250 body rows (`image` is not a body type, `whatsapp-message-campaign-queries.ts:16`), 0 null-code rows, 0 expired coupons |
| Lease | Won. The 2026-11-04 stamp is past the 5-minute throttle. It stamps and adds one job, and the old 250 image rows drop out of the QR count |
| Run | All 250 ledger-clear, so each is re-sent with the existing coupon code (`execute-campaign-broadcast.ts:105`) |
| Restriction not cleared | Meta rejects again and the run fails. The reason is rewritten with the correct "restricted" wording. Counters retract |
| Restriction cleared | 250 delivered and charged, images fail 131047, `completed`, and the card shows "250 coupon QR images could not be delivered". Warn-only, as ruled |

What they read before re-running:
- **Card banner: "no billing currency configured... Set the currency... then re-run".** This is the wrong cause. See I8.
- Card: `Sent 0`. The QR failed warning is hidden (`campaign-card-view.tsx:69`, sent count 0). The QR-only warning shows: "To reach them, create a new campaign with a quick-reply (claim) template."
- Sheet: `rerunConfirmBody`, `rerunCouponExpiry`, and the same QR-only warning (`rerun-campaign-dialog.tsx:27-28`). The template has an image header, no buttons and no body variable, so `isQrOnlyCouponCampaign` is true.

The gates assume the template and its review are still approved, as they were on 2026-11-04. Not read from prod.

**131031 / 131053 failed body rows.** Codes are non-null, so the guard passes and re-run is offered and accepted when the campaign is `failed`. The reason is the generic wording: "reported every message... (Meta error 131031: title). Check the number's health". That is fair for 131031 and imprecise for 131053 (media), but it claims nothing false. Meta decided, so there is no double-send exposure; a re-run with the cause unresolved fails again and retracts. Whether those prod campaigns are `failed` or `completed` was not read (unconfirmed — looked in: repo and workspace only; the codes are not in `src`).

**131042 / 130472 rows.** Same guard result. 130472 is a Meta experiment holdback, so those members are re-sent and Meta holds them back again, with no customer duplicate. The banner comes from the latest row: payment wording if 131042, generic if 130472. That ordering is ruled out of scope.

## 🔴 Critical (Must Fix)

**C2. A row the sweep marked `internal_orphan` passes the guard and leaves the ledger, so the member is sent twice. → plan (main thread; likely plan defect): C1's class survived the fix because the ruled predicate says "null error_code".**

Files:
- `src/infrastructure/supabase/repositories/whatsapp-message-campaign-queries.ts:115` (`.is('error_code', null)`)
- `src/application/rerun-evidence-guard.ts:24`
- `src/application/reconcile-orphan-messages.ts:12,25-31`
- `src/infrastructure/supabase/repositories/whatsapp-message-ledger-queries.ts:29` (`.neq('status', 'failed')`)

Problem: the sweep moves `queued` rows with no wamid, older than 5 minutes, to `failed` with `error_code='internal_orphan'`. Its comment says this means "we lost track", NOT "Meta refused", and that Meta may have sent the message. The guard's docstring promises to proceed only when rows "prove Meta definitively rejected", and the handoff calls the passing case "all-numeric", but the code only tests for null. The ledger stops counting the row the moment the sweep flips it, so its own rule that `queued` counts as sent lasts about 5 minutes. The sweep is live in prod: `scripts/cron/reconcile-orphan-messages.sh`, and a Forge run is recorded in `deploys/2026-08-28-wonb-018-019-release-runbook.md:38`.

Failing scenario:
1. During a run, Kapso accepts a send and Meta delivers it, but `attachKapsoMessageId` hits a Supabase timeout. The row stays `queued`, and the member tallies `errored`.
2. Five minutes later the sweep marks it `failed/internal_orphan`.
3. The campaign reaches `failed` by a reason that does not say delivery unknown. Either the run `completed` and the retract RPC later drained it (Meta wording, I2's remaining gap), or the job exhausted its retries on a mid-batch throw and `markCampaignFailed` wrote "Contact support if this persists".
4. The tenant clicks Re-run. `rerunBlock` is null, the guard is null, and the job re-sends to that member.

Likelihood is low, and the exposure is usually in-flight sends (up to `CONCURRENCY_LIMIT` 20 per sub-batch per blip), not a whole audience. But customers who have the message get a second marketing blast with a tenant click, and the sheet has just told the tenant those customers are skipped. A run reaching step 3 through a finalizer path with `errored > 0` is refused correctly, so only these two routes are exposed. A real prod row count is unknown (Open Question 1).

How it was shown failing: a scratch test built on the dev's C1 test, with real `executeCampaign`, `recordOutboundSend`, `reconcileOrphanMessages`, guard and ledger over the in-memory table; the wamid attach fails for member m-2 and the row is aged 6 minutes. Result: m-2's row goes `queued -> failed/internal_orphan`, `rerunBlock` null, `findRerunEvidenceRefusal` null, and 2 sends to m-2 across the two runs. File: `/private/tmp/claude-501/-Users-xavierau-Code-js-whatsapp-crm/9c2c27f1-8bb6-4336-9890-9c34bab7387d/scratchpad/camp014/orphan.test.ts`. Neither the guard's tests nor the route's cover this code; a grep for `internal_orphan` across them returns nothing.

Fix:
1. Main thread revises the ruling to "any failed body row without a Meta code, null or `internal_orphan`". The guard mechanism stays as ruled, and the existing `delivery_unconfirmed` refusal text fits.
2. In `countFailedBodyRowsWithoutMetaCode`, replace `.is('error_code', null)` with `.or('error_code.is.null,error_code.eq.internal_orphan')`. A numeric allow-list is stronger but its PostgREST filter is unverified here. Only these two non-Meta shapes exist today (grep of `error_code` writers).
3. Add the scenario above as a test, including the fake's `.or`.

## 🟡 Important (Should Fix)

**I8. Bicho's card keeps the wrong cause after release.** `campaigns.failure_reason` on `6fff0fa9-ccf3-4d55-9598-72f7f55421ed`; `campaign-card-view.tsx` failed banner; `debugging_journals/2026-11-05-bicho-campaign-131042-wrong-reason.md:31`.

The journal records this as a known consequence, but the brief's ruled list does not. Defect 1 in the investigation is the reason this item exists, and the one tenant it was written for still reads "no billing currency configured... Set the currency". They have a payment restriction. The only code path that rewrites it is a re-run, which sends 250 more messages and which the investigation says to hold. 長盈行 "Mid autumn 2026_test" has the same problem.

Fix: add a one-off, prod-data step to the release runbook, updating these two rows with `deliveryFailureReason`'s text for their real details, or tell both tenants directly. Owner's call, since it writes prod data. How to show it: after release, read the row and the card. The text is unchanged.

## 🟢 Minor (Optional)

**M2. The coupon-expiry line shows on coupon-less campaigns.** `rerun-campaign-dialog.tsx:27` renders "Coupons already issued keep their original expiry date" unconditionally. Fix: pass a coupon flag, or show it only when the campaign has a coupon config.

**M3. I5's time budget was not added, and no ruling records dropping it.** A hung template read or count still hangs the campaigns list. The exposure is much smaller now, and it is unmeasured. Main thread to accept, or dev to add it later. Not a re-send risk.

## ✅ Strengths

- The route order is correct and pinned, and each refusal is tested with no write.
- Counts cannot be capped by max-rows, and every failure closes.
- The revert is a CAS and cannot overwrite a run in `sending`.
- `rerunBlock` is shared by the card and the route, with the phrase shared by writer and predicate.
- The C1 test runs the real pipeline instead of a hand-written row, so its proof is sound for that path. C2 is the case it did not model.

## Open Questions

1. **Exposure today.** A read-only prod count of body rows with `error_code='internal_orphan'` on campaigns in `failed` status would show who could hit C2 right now. Not run.
2. **The ledger's comment is false after 5 minutes, and this predates CAMP-014.** `queued` counts as sent only until the sweep runs. A BullMQ retry, cron re-enqueue or operator PATCH later than that also re-sends orphans. The C2 fix closes the tenant route only. Counting `internal_orphan` in the ledger would close all of them, but it changes the send pipeline, which is ruled out here. Suggest a separate issue.
3. **Reason text.** If an orphan is the latest failed row, `findLatestCampaignFailure` could word the banner as "Meta error internal_orphan: Orphaned queued row...". The ordering is ruled out of scope, and the text is worth knowing about.
4. **Superseded status.** This artifact names `supersedes`, but my brief limits writes to this file and its index line, so the prior review's `status` is unchanged. Main thread to flip it.

## Verdict: BLOCKED

C2 is open: a tenant re-run can send a duplicate marketing message to a customer whose delivery is unknown, which plan item 4 and the C1 ruling exist to prevent. Everything else in the re-send path holds.

## Next Steps

1. Main thread revises the ruling per C2 and decides I8.
2. A cold `dev` round for the C2 predicate and test. M2 can go with it.
3. Re-review scoped to C2 only. Per the review cap, any further fix on this class needs a main-thread decision.
4. AC-4 for the record: `npx vitest run 'src/app/api/dashboard/campaigns/[id]/rerun' src/domain/services/__tests__ src/components/dashboard/__tests__/campaign-card-view.test.tsx` passed at 3c6b8518, 38 files, 656 tests.
