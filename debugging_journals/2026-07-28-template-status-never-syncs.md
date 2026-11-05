# Template status never syncs from Meta (issue #93, TPL-009)

## Problem

Tenant 釧 Kushiro's template `offer_promotion` / `zh_HK` (meta id `1029650636326514`)
read `pending` in our DB while Meta had it `APPROVED` — for ~18 days. Because
`check-template-review.ts` gates sending on `status === 'approved'`, campaigns on that
template were silently refused. Every tenant was affected, not just Kushiro: nothing in
the system was moving *any* template out of `pending` on its own.

## Root cause

Two code paths can move a template out of `pending`, and **neither ran in production**.

1. **The cron never fired.** `src/app/api/cron/sync-templates/route.ts` has existed for
   months and is correct — `syncTemplateStatus` would have matched this row (name +
   language match, `metaTemplateId` present, `pending` ∈ `SYNCABLE_STATUSES`,
   `APPROVED → approved`). But nothing ever called it. On the Forge box: no crontab for
   `forge`, no `/etc/cron.d` entry referencing the app, no systemd timer, no
   `vercel.json`, and **zero** `/api/cron` hits across the entire retained nginx
   access-log window. The `CRON_SECRET` env var was documented in `deploy/README.md`;
   the job that consumes it was never created.

2. **No webhook handler.** The webhook route handled
   `message_template_quality_update` but there was no handler — and no classification —
   for `message_template_status_update`. Such payloads fell through to the generic
   `{status:'ignored'}` branch.

So the only thing that ever fixed a status was a human pressing the dashboard sync
button (`POST /api/dashboard/wa-templates/sync`).

A second-order cause made the webhook gap harder to close than it looked:
`message_template_status_update` carries **neither** `phone_number_id` **nor**
`display_phone_number`. `resolve-tenant.ts` knew only those two identifiers, so even
with a handler the event could not have been attributed to a tenant. The only tenant key
on the payload is `entry[].id` — the WABA id.

## Solution

Two prongs, deliberately redundant: one guarantees convergence, the other reduces
latency.

**1. Scheduling (guaranteed).** `scripts/cron/sync-templates.sh` — a version-controlled,
fail-loud wrapper invoked by a Forge Scheduled Job every 15 minutes. It reads
`CRON_SECRET` / `APP_URL` from the environment then the site `.env` (exact-key grep,
never `source`), refuses to run with either missing, and uses `curl -fsS` so a non-2xx
response is a non-zero exit rather than a green-looking no-op. `deploy/README.md` gains a
`## Forge Scheduled Jobs` section with the exact command, user, and schedule.

**2. Webhook (near-real-time).** New `WebhookKind` `'template_status'`, extractor
`webhooks-template-status.ts` (Meta envelope + two defensive Kapso-flat shapes; numeric
`message_template_id` stringified; literal `"NONE"` reason normalised to null), handler
`template-status-handlers.ts` with the WAQ-006 claim-then-process idempotency posture,
and a third, shape-gated WABA rung in `resolve-tenant.ts` backed by a new
`findByBusinessAccountId`.

The Meta→local status map moved out of `sync-template-status.ts` into
`src/domain/services/meta-template-status.ts` so the cron path and the webhook path
share exactly one mapping and one `SYNCABLE_STATUSES` rule.

Ordering is plain last-write-wins by design: the 15-minute cron re-reads *live* Meta
state, so it cannot write stale data and repairs any webhook misordering within one
cycle. A persisted event-time guard would have needed a new column and migration for a
rare, self-healing case.

That reasoning has a sharp edge, caught in review: the cron only ever *looks at*
`SYNCABLE_STATUSES` rows (`pending`/`approved`/`paused`). So a webhook writing a
terminal status (`rejected`/`disabled`) would drop the row out of the cron's reach
permanently — one stale REJECTED landing after a real APPROVED would brick that
template forever, Meta saying APPROVED while we refuse to send. The self-healing
property only holds if the webhook can never write a status the cron cannot revisit,
so the write-guard now checks **both** ends: the row's current status must be
syncable, and so must the target. Terminal transitions are logged
(`webhook.template_status_deferred_to_cron`) and left to the cron, which reads
authoritative live state and therefore cannot persist a stale one — it also owns the
`rejection_reason` write. Cost: ≤15 min latency on rejections, which unblock nothing,
unlike approvals.

## Prevention

- **A documented env var is not a scheduled job.** `CRON_SECRET` sat in the deploy
  README for months and read as "cron is set up". Nothing verified the other half. Any
  future `/api/cron/*` route must land together with its scheduler entry in
  `deploy/README.md` — the route alone is dead code in production.
- **Ops scripts must fail loud.** `curl` without `-f` exits 0 on a 5xx; a scheduled job
  that silently no-ops is indistinguishable from one that had nothing to do. Same
  failure class as the deploy-script restart step (#56).
  While writing this fix, the script itself reproduced the class in miniature: an
  absent key in `.env` made `grep` exit 1, which `set -e` turned into a bare exit 1
  with the diagnostic never printed. Fixed with `|| true` so the explicit check reports
  *what* is missing.
- **A webhook handler is only reachable if the payload can be attributed to a tenant.**
  When adding a Meta event type, check which identifiers it actually ships before
  assuming the existing resolver covers it — `message_template_status_update` ships
  neither phone identifier.
- **"A later process will repair it" is only true within that process's filter.** The
  last-write-wins design leaned on the cron as a self-healing backstop without checking
  *which rows the cron actually reads*. Whenever a fix is justified by "X will fix it
  up later", state X's selection criteria and prove the write keeps the row inside them.
- **Silent status gates deserve alarms.** A template stuck `pending` for 18 days
  produced no signal anywhere; the bug surfaced only because someone compared our DB to
  Meta by hand.

## Ops follow-ups (not code)

1. Create the Scheduled Job in the Forge UI per the new README section and confirm the
   first run returns JSON with `restaurants` / `results`.
2. Confirm Kushiro's `offer_promotion` flips to `approved` afterwards (expected to
   self-resolve on the first successful run).
3. Confirm whether Kapso actually forwards `message_template_status_update` at all —
   evidence is `webhook.kind {kind:'template_status'}` log lines after a template
   submission. If none appear, the cron prong still fixes the bug; ask Kapso to enable
   forwarding.
