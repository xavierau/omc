---
id: artifacts/2026-11-12-book-001-rel2-handoff
type: handoff
contract: handoff-file-v1
author: dev
created: 2026-11-12
status: active
item: BOOK-001-REL2
state: done
brief: inline (BOOK-001-REL2 brief-v1, 2026-11-12)
base: 1d2d5ced
head: 1d398656 (main; the runbook commit lands on top)
branch: main
pushed: true
pr: [https://github.com/xavierau/omc/pull/180, https://github.com/xavierau/omc/pull/181]
stage: poc
gate: {result: pass, at: F3 fbe05814, note: "shipped src == fbe05814 (git diff empty)"}
next: {owner: main, action: "owner presses Save once in booking settings (OhMyClient, Simple) to resubmit the rejected templates; then watch Meta status"}
blockers: []
refs: [deploys/2026-11-12-book-001-release-runbook, artifacts/2026-11-12-book-001-f3-handoff, artifacts/2026-11-12-book-001-rel-handoff]
---
Record: `deploys/2026-11-12-book-001-release-runbook` § "Release 2". Raw logs (not committed) are in the session
scratchpad `rel2/` folder: `release.log`, `forge-deploy-82828241.log` and `smoke.log`.

```yaml
ac:
  REL2-01: {result: pass, evidence: "PR #180 squash 5da3eba5 → develop (ls-remote develop 5da3eba5, 15:22:26Z). PR #181 develop→main MERGEABLE/CLEAN, merge commit 1d3986567cbb (ls-remote main ✓, 15:22:54Z). merge-base --is-ancestor 5da3eba5 origin/main true"}
  REL2-02: {result: pass, evidence: "release.sh on the Mac under the heavy lock, exit 0 → release 397bc643, BUILD_ID riN6cf7pnVy9Nari180qV. Forge deployment 82828241 finished 15:26:33Z: npm ci skipped (lockfile unchanged), db push 'Remote database is up to date'. App pid 3850736→3863259, worker 3850810→3863333, both RUNNING. Box RELEASE.json source_commit 1d398656, .next/BUILD_ID riN6cf7pnVy9Nari180qV, /login embeds the new id once and the old id 0 times"}
  REL2-03: {result: pass, evidence: "/b/<random> 200 with no-store, no-referrer and noindex. POST /api/b/<random> {} 410 token_unusable. Both booking crons 401 with no bearer and with a bad bearer. /api/health 200, /login 200. Forge job 2216322 tick 15:30:01Z zero-work JSON; the wrapper prints the body only on 2xx and the route's only 2xx is 200. Logs: 0 fatal/uncaught/module/Redis errors"}
  REL2-04: {result: pass, evidence: "runbook § Release 2 + poc-log line + this file committed to main with a docs(deploys) prefix and pushed; ls-remote main == local HEAD (SHA in the caller report)"}
decisions:
  - "1. Ran the release from worktree --release-book001, not the brief's tree. It is tonight's release worktree and already holds .env.local and .env.production.local, which release.sh needs; the BOOK-001 tree has no .env.production.local. This also leaves the BOOK-001 tree on its fix branch. Nothing was built on the box"
  - "2. Proved the cron's HTTP 200 from the wrapper's success-only output plus the route code, instead of a manual bearer call. A manual run of booking-reminders can send a WhatsApp reminder, which the brief forbids"
  - "3. The POST smoke uses a '{}' JSON body. With no body the route answers 400 invalid_json (identical before and after the deploy). Tonight's 410 was with a body"
failed: []
invariants:
  - "No migration ran. No booking settings Save, template submission or WhatsApp send by dev"
  - "Rollback handle: local ref release-backup-034998b = 034998bb (tonight's release); the older release-backup-b0b4ef0 remains too"
unverified:
  - "Whether Meta approves the new copy. Known only after the owner's Save"
  - "The rollback caveat that the old sender mis-fills new-copy rows is inferred from the F3 diff, not tested"
review_focus: []
scope_drift: []
next_step: "Owner: Save once in booking settings. Cleanup when accepted: worktree --release-book001, box /home/forge/backups/2026-11-12-book-001/"
```
