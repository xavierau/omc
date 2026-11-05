---
id: artifacts/2026-11-05-camp-014-dev-round2-handoff
type: handoff
contract: handoff-file-v1
author: dev
created: 2026-11-05
status: active
item: CAMP-014
state: done
brief: inline
base: 1a9e1da5
head: "tip of fix/camp-014-failed-campaign-remedy (this file is inside that commit; SHA is in the return block)"
branch: fix/camp-014-failed-campaign-remedy
pushed: true
stage: poc
suite_changed: false
gate: {result: none, at: none}
next: {owner: verifier, action: "re-review 1a9e1da5..branch tip against reviews/2026-11-05-camp-014-absence; browser walk of the failed card and sheet"}
blockers: []
refs: [reviews/2026-11-05-camp-014-absence, artifacts/2026-11-05-camp-014-dev-handoff, investigations/2026-11-05-bicho-campaign-131042-wrong-reason]
---
ac:
  AC-1: {result: pass, evidence: "rerun/__tests__/route.test.ts 35 passed, red first. Tracking off, zero body rows, one null-code failed row and expired coupon each 409 with no write; all-numeric proceeds; 131047 409; each count's query error 500 with no write; lost lease stamps and adds one job when unscheduled, no job when scheduled; lease, stamp and job errors restore the reason; failed revert still 500 and logged"}
  AC-2: {result: pass, evidence: "application/__tests__ -t 'rerun|errored|retract': 14 passed, red first. rerun-evidence-transport-failure.test.ts runs real executeCampaign, recordOutboundSend, template client and count queries over an in-memory table with sendTemplate rejecting TypeError('fetch failed'): rows failed, error_code null, rerunBlock null, guard refuses. execute-campaign.test.ts: sent 1, errored 2, lost CAS writes the delivery-unknown reason"}
  AC-3: {result: pass, evidence: "domain, query and list tests green, red first. campaign-rerun.test.ts covers no_service_window. campaign-qr-only.test.ts covers {{couponCode}} and COPY_CODE. Count applies queued_at >= bound only when non-null. List counts only QR-only campaigns with counted sends; claim, code-carrying and coupon-less campaigns issue no count query"}
  AC-4: {result: pass, evidence: "src/components/dashboard: 927 passed. Neutral wording in both languages, failed-card wording, sheet warning and expiry, button hidden on 131047, refusal shown and refetch on 409 and 500. app/dashboard/campaigns/__tests__/page.test.tsx: cards stay mounted during a refetch"}
  AC-5: {result: pass, evidence: "tsc exit 0. Full suite 6066 passed, 46 skipped, 2 todo, 0 failed. eslint on all changed files clean; the known use-campaigns.ts error is not in this diff. en.json and zh-HK.json key sets match (1173)"}
  AC-6: {result: pass, evidence: "journal updated, one fix: commit, pushed with rtk proxy git push, ls-remote SHA equals HEAD"}
decisions:
  - "Campaign gains lastEnqueuedAt: string | null in entity, mapper and builders — the entity did not expose it [main ruling E1]; it also appears in the tenant's own list JSON"
  - "A null error_code on a failed body row refuses, including webhook rows with a kapso_message_id — a wrong refusal is recoverable, a duplicate blast is not [main ruling E2]"
  - "app/dashboard/campaigns/page.tsx shows the skeleton only when the list is empty — not named in the brief, but required by it: isLoading unmounted every card on refetch, so the refetch would have erased the refusal AC-4 says is shown. Side effect: the list no longer flashes the skeleton after any refetch"
  - "Count query now depends on the template read instead of running alongside it — with no read, no campaign is known to be QR-only, so no count. The earlier test that pinned a count without the flag was changed to match the fixed rule"
  - "Template read skips coupon-less campaigns — the brief says they cost no query"
  - "The revert also logs at error when it matches no active row — the row moved on, so the 500 may not mean nothing was sent"
  - "Lease and revert logic lives in application/enqueue-revived-campaign.ts, keeping the route thin"
failed: []
invariants:
  - "The evidence guard runs after rerunBlock and before gates or any write"
  - "NO_SERVICE_WINDOW_PHRASE also occurs in the pre-CAMP-014 131047 wording, so old stored reasons are refused too (read from 99c1f6b3)"
unverified:
  - "No browser run: the worktree has no env and DEV Supabase lags (incident_no_browser_env_for_db_features). Card, sheet and page are proven by render tests only; the sheet's new warning block has never been seen rendered. Owner: verifier"
  - "Impeccable detector ran on source only (0 findings); rendered and 390x844 passes not run, same reason. Owner: verifier"
  - "E2, read from code, not run: extractErrorCode returns null when a failed webhook has no errors, and coerceStatus maps unknown status strings to failed. Such rows refuse a re-run though Meta may have decided. Main reports no such rows in prod today"
  - "Accepted limit, E1: /execute does not stamp last_enqueued_at, so a Send Now after an earlier stamp still counts rows since that stamp, including an earlier run's"
  - "Accepted limit, E1: a re-run whose job fails after taking the lease keeps the new stamp after the revert, so the QR count can read low until the next run. It only affects a failed campaign that still has counted sends"
  - "Consequence raised to main, implemented as fixed: a sync Meta 4xx (kapso_send_error, null code) and a queue failure before any send (zero body rows) both get the contact-support refusal, while 'All N message sends failed... before retrying' still invites a retry and the card still shows the button. Main reports this to the owner"
  - "No live re-run against Meta; production untouched"
review_focus:
  - "src/infrastructure/supabase/repositories/coupon-campaign-queries.ts countExpiredCampaignCoupons: filters campaign_id, restaurant_id and expires_at with no type filter, per 'any coupon'. The only campaign_id index found is the partial promo unique index from migration 053, which this query cannot use; it runs per re-run click, not per list, and no migration was allowed. Unmeasured"
  - "src/application/enqueue-revived-campaign.ts: a cron tick can lease and enqueue between the revive and the revert. The worker's active -> sending CAS then refuses the job once the row is failed; traced by reading only"
  - "src/application/rerun-evidence-guard.ts: failed rows accumulate across runs, so one null-code row blocks re-run permanently, even if a later attempt for that member got Meta's code. Intended by the fixed rule"
scope_drift: []
in_flight: []
next_step: "Dispatch verifier re-review of C1 and I1-I7, plus /code-review on the re-send path, before any PR."
