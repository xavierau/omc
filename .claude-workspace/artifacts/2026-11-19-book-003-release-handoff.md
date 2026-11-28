---
id: artifacts/2026-11-19-book-003-release-handoff
type: handoff
contract: handoff-file-v1
author: dev
created: 2026-11-19
status: active
item: BOOK-003
state: done
brief: inline (main, BOOK-003 release)
base: 230a61beeee987b7b2865bef88c85651a8fef5e4
head: main 45a10231 → release da99e4d4; docs on branch docs/book-003-release-runbook
branch: docs/book-003-release-runbook
pushed: true
stage: poc
gate: {result: pass, at: 2026-11-19T07:20:13Z}
next: {owner: main, action: "live test brief (test tenant + test domain serving poppy.json, Claude as the agent); decide on the --book-003 worktree (wt-finish refuses, squash-merged)"}
blockers: []
refs: [deploys/2026-11-19-book-003-release-runbook, plans/2026-11-19-agent-booking-poppy, threats/2026-11-19-agent-booking-poppy, github:192, github:193]
---

ac:
  AC-1: {result: pass, evidence: "gate on 230a61be under the heavy lock: npm ci 0, tsc 0, vitest 0 (642 files / 7,202 tests passed, 79 skipped, 2 todo). poc-log conflict escalated; main-approved sync PR #192 (merge commit) → develop 7d4decf6; release PR #193 CLEAN → main merge commit 45a10231a3efc686ea40d5a36e0c47a6bd6b8d31 (07:42:50Z). src supabase scripts package* deploy.sh equal 230a61be (evidence ac1-*, sync-proof.log)"}
  AC-2: {result: pass, evidence: "07:19:50Z, before release.sh: managed backup 2306777673 COMPLETED 2026-11-18T19:32:11Z; box /home/forge/backups/2026-11-19-book-003/ (700/600) restaurants.json 7 rows, booking_requests.json 0 rows, managed-backups.json, baseline-catalog.json, sha256 in the runbook; ledger tail 083, promote_agent_booking absent"}
  AC-3: {result: pass, evidence: "release.sh exit 0, bundle scan clean, BUILD_ID 4VXrhhE4uWnAnm-o-34bu; origin/release 55995fa2 → da99e4d4 (old kept as local ref release-backup-55995fa); box RELEASE.json source_commit 45a10231… == main merge commit, build_id == .next/BUILD_ID; app next-server 3027483 → 3129673, worker 3027518 → 3129734"}
  AC-4: {result: pass, evidence: "08:21:54Z: ledger 084 agent_booking; status CHECK has unverified, source CHECK has agent, decision_consistent (status IN (unverified,pending)) = (decided_at IS NULL); 6 columns, 3 booking_requests indexes, restaurants_agent_booking_public_id_idx; promote_agent_booking exists, EXECUTE anon/authenticated false, service_role true; counts 7 / 0 / 4,227 unchanged; 0 restaurants agentBooking enabled (evidence ac4-migration-084.log)"}
  AC-5: {result: pass, evidence: "3 poppy routes 404 JSON with cache-control no-store and referrer-policy no-referrer; 3 settings routes 401; health 200, login 200, cron 401 without bearer; job 2216322 tick 08:25:01Z 200 with unverifiedDeleted:0; /login embeds new BUILD_ID once, old 0; pids alive 5:27 / 5:24; 0 fatal lines (evidence ac5-*)"}
  AC-6: {result: pass, evidence: "NEXT_PUBLIC_APP_URL in .env.production.local host app.ohmyclient.io; NEXT_PUBLIC_PRIVACY_URL absent everywhere, code default https://ohmyclient.io/privacy-policy.html used (evidence ac6-env.log)"}
  AC-7: {result: pass, evidence: "runbook deploys/2026-11-19-book-003-release-runbook, poc-log line, kanban BOOK-003 notes 'released dark', status unchanged (review); docs PR into develop; rel-book003 deleted, ls-remote empty"}
  AC-8: {result: pass, evidence: "wt-finish --book-003 after the main merge: REFUSED, exit 1 (output below), stopped there. wt-finish of --release-book003 runs after this PR merges; its output is in the dev return block"}
wt_finish_output: |
  $ python3 ~/.claude/bin/wt-finish /Users/xavierau/Code/js/whatsapp-crm--book-003
  REFUSED /Users/xavierau/Code/js/whatsapp-crm--book-003: feature/book-003-agent-booking has 42 commit(s) not in main
  exit=1
decisions:
  - "Cron tick checked from the box's Forge job log /home/forge/.forge/scheduled-2216322.log (response body carries unverifiedDeleted only from the new code)"
  - "Random 404 probe ids from openssl rand / uuid4"
  - "Kanban BOOK-003 left in its current column (review); brief says status stays, only notes added"
  - "Evidence ac6-env.log: the local .env.local tunnel host redacted (public repo)"
failed:
  - tried: "release PR develop→main as first planned"
    why: "merge-tree conflict in .claude-workspace/poc-log.md (main's 3 direct docs commits never synced to develop)"
    evidence: "runbook § Scope"
    replaced_by: "main-approved sync PR #192 (merge commit), then release PR #193 CLEAN"
invariants:
  - "0 restaurants have agent booking enabled; no test tenant, DNS change or WhatsApp message"
  - "Local ref release-backup-55995fa is the code rollback handle; keep it"
unverified:
  - "deploy.sh console output for the 084 push not captured; the ledger and catalog are the proof"
  - "Fail-open limiter: first agent POST after the restart logged '[AgentBooking] rate limiter unavailable'; later probes did not (pre-existing BOOK-001 pattern)"
review_focus: []
scope_drift:
  - "PR #192 brought 5 main-only workspace files to develop (approved by main)"
in_flight: []
next_step: "Main dispatches the live test brief."
