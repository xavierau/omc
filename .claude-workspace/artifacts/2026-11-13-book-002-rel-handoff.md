---
id: artifacts/2026-11-13-book-002-rel-handoff
type: handoff
contract: handoff-file-v1
author: dev
created: 2026-11-13
status: active
item: BOOK-002-REL
state: done
brief: inline (BOOK-002-REL brief-v1, 2026-11-13)
base: 9190bde5
head: cf8b4aa6 (main; the runbook commit lands on top)
branch: main
pushed: true
pr: [https://github.com/xavierau/omc/pull/182, https://github.com/xavierau/omc/pull/183]
stage: poc
gate: {result: pass, at: F1 69c00c41, note: "9190bde5 and 031ce796 add workspace docs only"}
next: {owner: main, action: "owner presses Save once in booking settings (OhMyClient, Simple) to resubmit the rejected zh_HK reminder; then watch Meta status"}
blockers: []
refs: [deploys/2026-11-12-book-001-release-runbook, reviews/2026-11-13-book-002-re-review, artifacts/2026-11-13-book-002-f1-handoff]
---
Record: `deploys/2026-11-12-book-001-release-runbook` § "Release 3". Times are UTC (2026-11-12). The raw release log
(not committed) is in the session scratchpad, `release3.log`.

```yaml
ac:
  REL3-01: {result: pass, evidence: "re-review committed 031ce796 on feature/book-002 (ls-remote ✓). PR #182 squash 7642764c → develop 16:41:24Z (ls-remote develop 7642764c). PR #183 develop→main MERGEABLE/CLEAN, merge commit cf8b4aa60f63 16:41:48Z (ls-remote main ✓); merge-base --is-ancestor 7642764c origin/main true"}
  REL3-02: {result: pass, evidence: "release.sh on the Mac under the heavy lock, exit 0 → release 25532d94, BUILD_ID aVfHeC7nQOiLbXFbj4ZO_. Forge deployment 82836831 finished 16:46:32Z: npm ci skipped, db push 'Remote database is up to date'. App pid 3863259→3893164, worker 3863333→3893239 (tsx scripts/start-worker.ts from the checkout at 25532d94), both started after the deploy and RUNNING. RELEASE.json source_commit cf8b4aa6 + build_id == .next/BUILD_ID; /login embeds the new id once, the old 0 times"}
  REL3-03: {result: pass, evidence: "/b/<random> 200 no-store/no-referrer/noindex; POST /api/b/<random> {} 410; booking crons 401 (no and bad bearer); /api/health 200, /login 200; settings/booking GET without session 401 (not 500); Forge job 2216322 tick 16:50:02Z zero-work JSON (wrapper prints body only on 2xx → 200). OhMyClient legacy booking_config (no rev, no templateBodies/Candidates) read through getBookingConfig + bookingTemplateOverviewFor from the deployed source on the box: 8 slot views, reminder.zh_hk rejected, 7 pending, no error, select only"}
  REL3-04: {result: pass, evidence: "runbook § Release 3 with rollback to Release 2 and the N4 ops note + rev-bumping AI-routing SQL, poc-log line and this file committed to main (docs(deploys)) and pushed; ls-remote main == local HEAD (SHA in the caller report)"}
decisions:
  - "1. Released from worktree --release-book001 (holds .env.local / .env.production.local, which release.sh needs), as Release 2 did; merges ran from the brief's tree. Nothing built on the box"
  - "2. The legacy-shape read ran the real settings GET functions with tsx in the deployed checkout (script in /tmp, deleted after), instead of an authenticated GET, which would need a tenant session"
  - "3. The old AI-routing SQL in artifacts/2026-11-12-book-001-w2-handoff:32 is outside files_allowed, so the runbook names it superseded instead of editing it"
failed:
  - "First read script printed ov.slots with .map (slots is a record, not an array); the overview itself returned fine. Re-ran with a record walk"
invariants:
  - "No migration ran. No booking settings Save, template edit, template submission or WhatsApp send by dev. No secret printed"
  - "Rollback handle: local ref release-backup-397bc64 = 397bc643 (Release 2); release-backup-034998b and release-backup-b0b4ef0 remain"
unverified:
  - "Prod PostgREST accepting the booking_config->>rev CAS filters: only a write exercises it; the first owner Save is the check"
  - "Whether Meta approves the new zh_HK reminder copy. Known only after the owner's Save"
  - "Rollback caveat (Release 2 sender with custom-text rows) inferred from the diff, not tested"
review_focus: []
scope_drift: []
next_step: "Owner: Save once in booking settings. Cleanup when accepted: worktree --release-book001, box /home/forge/backups/2026-11-12-book-001/"
```
