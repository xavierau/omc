---
id: artifacts/2026-11-05-camp-014-dev-handoff
type: handoff
contract: handoff-file-v1
author: dev
created: 2026-11-05
status: active
item: CAMP-014
state: done
brief: inline
base: 99c1f6b3
head: "tip of fix/camp-014-failed-campaign-remedy (this file is inside that commit; SHA is in the return block)"
branch: fix/camp-014-failed-campaign-remedy
pushed: true
stage: poc
suite_changed: false
gate: {result: none, at: none}
next: {owner: verifier, action: "review 99c1f6b3..branch tip, then /code-review on the re-send path; browser walk of the failed card"}
blockers: []
refs: [plans/2026-11-05-camp-014-failed-campaign-remedy, investigations/2026-11-05-bicho-campaign-131042-wrong-reason]
---
ac:
  AC-1: {result: pass, evidence: "campaign-delivery-failure-reason.test.ts + reconcile-campaign-send-failure.test.ts, red then green; fixture kapso-v2-failed-131042-restricted.json goes through normalizeStatusPayload + mapStatusUpdate"}
  AC-2: {result: pass, evidence: "execute-campaign.test.ts: retracted run worded from row detail; errored run's stored reason satisfies isDeliveryUnknownReason"}
  AC-3: {result: pass, evidence: "rerun/__tests__/route.test.ts; gate parity drives /rerun and /execute through each failing gate and compares status + body"}
  AC-4: {result: pass, evidence: "vitest src/domain/services/__tests__ -t qr: 12 passed"}
  AC-5: {result: pass, evidence: "execute-campaign-send.test.ts, campaigns/__tests__/route.test.ts, whatsapp-message-campaign-queries.test.ts"}
  AC-6: {result: pass, evidence: "src/components/dashboard green: campaign-card-view, campaign-card (real handlers via useState stub), rerun-campaign-dialog, campaign-form-fields"}
  AC-7: {result: pass, evidence: "en.json + zh-HK.json keys in campaigns namespace; 5 rows appended to testid-registry.md, marked render tests only"}
  AC-8: {result: fail, evidence: "tsc exit 0. Full suite 6010 passed, 46 skipped, 2 todo, 0 failed, no flaky failures. eslint: 1 error, react-hooks/set-state-in-effect at src/hooks/use-campaigns.ts fetchCampaigns effect; same error on the 99c1f6b3 version of the file, line untouched here. Left per 'do not fix unrelated smells'; silencing it would break the craft rule"}
  AC-9: {result: pass, evidence: "inputs copied, journal Solution implemented filled, one fix: commit, pushed, ls-remote SHA equals HEAD"}
decisions:
  - "Delivery-unknown wording moved from execute-campaign.ts to domain campaign-delivery-failure-reason.ts — the client card needs the predicate and must not import the server executor [fixed: predicate next to wording]"
  - "rerunBlock in domain/services/campaign-rerun.ts is the one rule for route and card — the button is never offered for a request the route refuses"
  - "Shared code: application/enforce-campaign-send-gates.ts and [id]/campaign-send-error-response.ts; /execute now delegates to both — parity by construction [fixed]"
  - "Confirmation uses Sheet in a new rerun-campaign-dialog.tsx, mirroring end-campaign-dialog.tsx — existing primitive, no window.confirm [fixed]"
  - "qrFailedCount is requested and returned only for campaigns with counted sends — the card shows nothing otherwise, so all-failed and draft campaigns cost no query; batched 10 at a time"
  - "QR-only rule uses extractParameters, which scans every text component, not only BODY — a {{code}} in a text header also reaches the customer, so warning there would be false"
  - "Meta error title in the generic reason is clamped to 120 chars — needed for the FAILURE_REASON_MAX_LEN pin"
failed: []
invariants:
  - "Gates run before any write on /rerun; a blocked re-run leaves the campaign failed with its reason"
  - "image message_type on a campaign row is only the QR: the sole writers are execute-campaign-send.ts and claim-handler.ts; welcome sends record template rows"
unverified:
  - "No browser run — the worktree has no env and DEV Supabase lags (incident_no_browser_env_for_db_features). Card, sheet and form notices are proven by render tests only. Owner: verifier"
  - "Impeccable detector ran on source only (exit 0, 0 findings); rendered and 390x844 passes not run, same reason. Owner: verifier"
  - "Payment-method detail string in tests is from memory of Meta's text, not read from prod; the match is on the substring 'payment method' per the brief. Restricted and currency strings come from the investigation and the existing fixture. Owner: main"
  - "Live re-run against Meta not exercised; production untouched"
review_focus:
  - "src/app/api/dashboard/campaigns/[id]/rerun/route.ts: DECISION lost lease. 'Another job is in flight' is false for an unscheduled campaign re-run twice within 5 min: only /rerun and the cron set last_enqueued_at, so the second re-run answers queued, adds no job, and nothing fires because scheduled_at is null. The campaign sits active with Send Now. No double-send. Implemented as fixed; recommend answering a distinct status or enqueuing when scheduled_at is null"
  - "src/infrastructure/supabase/repositories/whatsapp-message-campaign-queries.ts countFailedCampaignQrImages: DECISION count spans all runs. No run id exists, so a re-run keeps counting the earlier run's failed images. Bicho's 250 failed QR rows would keep the warning after a successful re-run and it would say 250 customers got no code, possibly wrongly. Needs a run marker or a member-level check, which conflicts with head counts only"
  - "src/components/dashboard/campaign-card-view.tsx: DECISION a 131047 failed card still offers re-run while its reason says to create a new campaign. The brief refuses only delivery-unknown"
  - "rerun/route.ts: a job or lease failure after the CAS answers 500 with the campaign already active and reason cleared. Due campaigns recover via cron; others after reload via Send Now"
scope_drift: []
in_flight: []
next_step: "Dispatch verifier and /code-review on the re-send path, and rule on the three DECISION items in review_focus before release."

Unrelated smells, not touched:
- PATCH /campaigns/[id] can still set status active on a delivery-unknown campaign, bypassing the gates and this refusal.
- claim-handler.ts sendQrImage still uploads outside the tracked send, so its upload failure leaves no row.
- The generic reason branch embeds Meta's title, which is raw Meta text (existing test pins it).
- Stored reasons on Bicho and 長盈行 keep the old wording until a new run writes a new one.
