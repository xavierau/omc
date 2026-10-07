# Scheduled broadcasts never fire in production (issue #95)

**Date**: 2026-07-28
**Issue**: [#95](https://github.com/xavierau/omc/issues/95)
**Reported by**: tenant 釧 Kushiro — scheduled broadcast "testing broadcast" never sent
**Related**: #93 (same failure class), #56/#83 (silently-green ops steps)

## Problem

Campaign `3f663bf2-481f-4084-9e3f-0d1cdeadeaf7`, tenant 釧 Kushiro. Approved
MARKETING template, 1 resolved member, `status='active'`, `scheduled_at`
2026-07-28T09:02:00Z. Verified at 09:08Z: nothing sent, no job, no error.

Everything the send needed was in place. The send simply never started.

## Root cause

**Nothing in production ever called `GET /api/cron/campaigns`, and that route
is the only producer of scheduled-campaign jobs.**

The chain, verified in code:

1. `getDueCampaigns()` selects `status='active' AND scheduled_at <= now()`.
2. Its only caller is `src/app/api/cron/campaigns/route.ts`.
3. `addCampaignJob()` has two call sites: that route, and the manual "send
   now" button (`/api/dashboard/campaigns/[id]/execute`).
4. There is no in-process scheduler — no `setInterval`, no BullMQ repeatable
   job, no `instrumentation.ts`. `scripts/start-worker.ts` starts three
   **consumers** only.

On the prod box: `crontab -l` as `forge` → no crontab. The only Forge
Scheduled Jobs were server-level (composer self-update, apt update). No site
job existed.

So `campaign-execution` had a consumer and no producer. Scheduled broadcasts
had **never** fired in production — consistent with the tenant's two
`completed` campaigns both having `scheduled_at = null` (manually executed).

## Why it survived so long

`deploy/README.md` actively forbade the fix:

> **Do not** schedule `/api/cron/campaigns` this way — campaign execution is
> already owned end-to-end by the `ohmyclient-worker` BullMQ daemon above;
> blind-scheduling the same endpoint on top of that risks double-sends.

The premise conflates two different things. The worker owns **execution**; it
does not own **scheduling**. Since nothing produced the job, there was no
double-send risk to protect against — only a zero-send bug, and a doc that
told every future reader not to fix it.

## What the issue got wrong

The issue proposed claiming the campaign (`active → sending`) *at enqueue
time*, on the belief that the cron path has no compare-and-swap. It does — but
one layer down: `executeCampaign` (`src/application/execute-campaign.ts:53`)
CAS-claims `active → sending` before sending anything, and a duplicate job
loses that CAS and aborts. Double-sends were never the exposure.

The real exposure from turning the cron on every minute is the opposite
shape — an **enqueue storm**. `executeCampaign` throws in several places
*before* its claim: unapproved template, `NoTemplateError`, missing
`phone_number_id`, execution-time guardrail with the real member count. On any
of those the campaign stays `active` with a past `scheduled_at`, so every tick
re-selects and re-enqueues it: 1440 ticks/day × 3 BullMQ attempts, each doing
full member resolution and template lookups, forever, silently.

Claiming at enqueue time would also have been a one-way door: if the job were
ever lost (Redis flush, worker restart), the row would sit in `sending`,
outside `getDueCampaigns`' filter, with no backstop to recover it.

## Solution

1. **`scripts/cron/campaigns.sh`** — Forge Scheduled Job entrypoint, every
   minute. Third cron wrapper in the repo, so the shared bash (env reading,
   fail-loud checks, `curl -f`, secret via `-K -` not argv) was extracted into
   `scripts/cron/run-cron-endpoint.sh`; `sync-templates.sh` now delegates to
   it with identical behavior and an unchanged Forge command.
2. **Enqueue lease** — migration 061 adds `campaigns.last_enqueued_at`, and
   `claimCampaignForEnqueue()` takes it with a compare-and-swap
   (`status='active' AND (last_enqueued_at IS NULL OR < now() - 5min)`). The
   cron leases *before* enqueueing and reports a `throttled` count. A stuck
   campaign now costs at most 12 enqueues/hour instead of 4320/day, and
   overlapping ticks cannot double-enqueue. The lease expires on its own, so
   nothing is bricked — deliberately not a status transition.
3. **`deploy/README.md`** — the wrong "do not schedule" paragraph is replaced
   with the correct reasoning and the rule that *every* `/api/cron/*` route
   must have a job listed there.
4. **`reconcile-orphan-messages`** (#95 item 4) — same un-wired status,
   wrapper added and scheduled `*/10`.

## Prevention

- **A documented `/api/cron/*` route is not a scheduled job.** This is the
  second occurrence (#93 was the first). The route and its scheduler entry now
  ship together, and `deploy/README.md` states the rule as an invariant with
  the complete route list, so a new cron route without a wrapper is a visible
  gap rather than an invisible one.
- **Ops guidance that forbids something needs the mechanism spelled out.** The
  "risks double-sends" line had no mechanism behind it and was wrong; it cost
  months of dead scheduling. The replacement names both guards explicitly so
  the next reader can check the claim instead of trusting it.
- **Before turning on a loop, ask what happens when the work inside it fails.**
  The interesting bug here was not the missing trigger — it was what the
  missing trigger had been hiding.
