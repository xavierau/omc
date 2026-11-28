---
id: artifacts/2026-11-12-book-001-rel-handoff
type: handoff
contract: handoff-file-v1
author: dev
created: 2026-11-12
status: active
item: BOOK-001-REL
state: done
brief: inline (BOOK-001-REL brief-v1 r2, 2026-11-12)
base: dd7fcd53
head: 7ccf66e0 (main, release merge); docs commit on top, see deploys/2026-11-12-book-001-release-runbook
branch: develop (c34011ae), then main via PR #179
pushed: true
pr: https://github.com/xavierau/omc/pull/179 (merged 14:54:06Z, merge commit 7ccf66e0)
stage: poc
gate: {result: pass, at: 2026-11-12T14:55Z, head: dd7fcd53}
next: {owner: main, action: "relay Findings 1-2 to the owner (OhMyClient booking switched on by someone after the deploy; Meta rejected 6/8 booking templates)"}
blockers: []
refs: [deploys/2026-11-12-book-001-release-runbook, deploys/2026-11-05-camp-014-release-runbook, deploys/2026-10-07-mem-001-004-release-runbook]
---
Primary artifact: `deploys/2026-11-12-book-001-release-runbook` (every command, timestamp, id, check and rollback).
Evidence (session scratchpad, not committed):
`/private/tmp/claude-501/-Users-xavierau-Code-js-whatsapp-crm/3cb32181-80a7-4181-b851-1a83b83f14f3/scratchpad/rel/`.
It holds `logs/release.log` and `logs/forge-deploy.json`, plus `merge/{main,dev}.txt`, the two poc-log blobs.

```yaml
ac:
  REL-01: {result: pass, evidence: "origin/main merged into develop as c34011ae. Only poc-log.md conflicted; it was resolved as the union. 0 U entries and 0 markers. git diff origin/main..merge -- poc-log.md shows 0 removed lines, and every main and dev line is present (grep -xF). develop was pushed and ls-remote shows c34011ae. #179 was MERGEABLE CLEAN and merged --merge into 7ccf66e0; ls-remote main shows 7ccf66e0, which contains dd7fcd53 and bfb09dc7"}
  REL-02: {result: pass, evidence: "Backup 2236199520 is still COMPLETED (14:54Z). deploy.sh db push printed 'Applying migration 082_booking.sql... Finished'. The ledger lists 080, 081 and 082. The three tables exist with RLS and 0 rows. booking_config defaults to {mode:off} NOT NULL. book_now_enabled defaults to false NOT NULL; booking_url is a nullable text column. The function's ACL is {postgres,service_role}. Counts are unchanged: 7, 46 and 4189"}
  REL-04: {result: pass, evidence: "Box at 14:54/14:57Z: 658 MB available, swap full. The build ran off-box and npm ci was skipped (lockfile unchanged), so the only on-box steps were the db push, the seeder and the restarts. release.sh exit 0 produced release 034998b with BUILD_ID 7umNlW5VKJJkTi6w2JwzR. Forge deployment 82824664 finished. RELEASE.json and .next/BUILD_ID match. App pid 3850736 and worker pid 3850810 are RUNNING (were 78688 and 78805). The chunk /login references returns 200"}
  REL-05: {result: pass, evidence: "Forge jobs 2216322 (*/5, booking-reminders.sh) and 2216323 (30 3 * * *, booking-retention.sh) are installed as user forge. Manual runs exited 0 with HTTP 200: reminders {candidates:0,due:0,sent:0,notDelivered:0,claimLost:0}; retention {purged:0,cutoffDate:2026-05-16}. The scheduler tick at 15:05:01Z produced the same output"}
  REL-06: {result: pass, evidence: "GET /b/<43-char random> returns 200 with the unavailable page, no-store, no-referrer and noindex. POST /api/b/<random> returns 410. Both cron routes return 401 without a bearer. /login and /api/health return 200, and the rerun route returns 401 as before. The webhook log since 14:58Z has 0 real webhooks, which matches the overnight rate. An unsigned probe was logged with valid:false and got 401. booking.classified appears 0 times in both logs"}
  REL-07: {result: pass, evidence: "deploys/2026-11-12-book-001-release-runbook was committed to main with the docs(deploys) prefix and pushed; ls-remote is verified in the caller's handoff block. It contains no secret value, only key names and lengths"}
decisions:
  - "082 was applied by deploy.sh's db push, after the checkout sync and before the restart. This is the MEM-001 precedent and keeps the ledger intact"
  - "Box memory was low but not escalated: no build runs on the box (the build is off-box and npm ci was skipped). MEM-001 deployed at 476 MB"
  - "No rollback for Findings 1-2: they concern the new feature on one tenant, not existing traffic"
  - "poc-log BOOK-001 line updated to 'shipped prod dark'; deploys index line added"
failed: []
invariants:
  - "Booking was off for all 7 restaurants at deploy time. dev enabled nothing, sent nothing and submitted nothing"
unverified:
  - "Who switched OhMyClient to Simple mode at 14:59:28Z: actor unknown; the dashboard settings PUT is inferred from template provisioning"
  - "Real inbound webhook routing after the deploy: no traffic arrived in the window"
  - "The boot-time rate-limiter warning's cause, inferred as a handshake race"
review_focus:
  - "Meta rejected booking_confirmed, booking_declined and booking_reminder (en and zh_HK) with 2388293 Params Words Ratio Exceeds Limit. The copy in src/domain/services/booking-templates.ts needs more words per variable"
scope_drift: []
next_step: "Owner: confirm the OhMyClient switch-on was intended. Plan a fix for the booking template copy (new work item). Delete /home/forge/backups/2026-11-12-book-001/ and the --release-book001 worktree once accepted"
```

## Findings
1. OhMyClient (`2e578557…`) has `booking_config.mode = simple` since 14:59:28Z. dev did not set it.
2. Of the 8 booking templates submitted then, 6 were rejected by Meta and 2 are pending (received).
   - Rejected: confirmed, declined and reminder, each in en and zh_HK.
   - Without approved templates, those messages fail outside the 24-hour window.
3. One fail-open `[Booking] rate limiter unavailable` at boot. It was not repeated; Redis answers PONG and has no errors.

## Disclosure carried from r1
In r1, about 23 characters of a corrupted copy of the prod `SUPABASE_ACCESS_TOKEN` (its 2s and 7s stripped) were
printed into the agent transcript. They were not written to any file. Rotating the token is the owner's call. In r2 no
secret was printed: presence was checked by length only.
