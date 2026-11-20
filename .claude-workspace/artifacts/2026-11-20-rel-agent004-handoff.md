---
id: artifacts/2026-11-20-rel-agent004-handoff
type: handoff
contract: handoff-file-v1
author: dev
created: 2026-11-20
status: active
item: AGENT-004
state: done
brief: inline (main, AGENT-004 release brief-v1, base 94e868ed)
base: 94e868ed4959e99a238cd4c3cc44f979ed9a7584
branch: docs/agent-004-release-records (records PR into develop)
pr: https://github.com/xavierau/omc/pull/205 (develop → main, merged 02:31:57Z, 4af4caaf)
stage: poc
gate: {result: pass, at: 2026-11-20T02:27:02Z}
next: {owner: main, action: "owner does the live omc check (a reply to the agent's booking question stays with the agent); fill the poc-log outcome"}
blockers: []
refs: [deploys/2026-11-20-agent-004-release-runbook, artifacts/2026-11-20-agent-004-handoff, kanban:AGENT-004]
---
# REL-AGENT-004: AGENT-004 released to production

Prod serves `main@4af4caaf`, release `e5ddd701`, BUILD_ID `zzJgH7D65-G0P4rKNa3uS`, app pid 3531138, worker pid
3531178. No migration. Full record: `deploys/2026-11-20-agent-004-release-runbook`. Evidence:
`artifacts/evidence/2026-11-20-agent-004-release/`. All times UTC.

## ac
- **AC-1: pass.** On `94e868ed` under the heavy lock (02:25:16–02:27:02Z): `npm ci` 0, `tsc --noEmit` 0,
  `vitest run` 0 (661 files / 7,541 tests passed). `ac-gate-*.exit`.
- **AC-2: pass.** PR #205 develop → main: `git merge-tree` exit 0, tree `6f4dc031` == develop tree; CodeRabbit pass
  (the repo has no GitHub workflows; same as #202), MERGEABLE/CLEAN; merged with a merge commit 02:31:57Z →
  `4af4caaf`, whose tree == `94e868ed`'s tree.
- **AC-3: pass.** `release.sh` exit 0, bundle scan `clean`; `ls-remote release` b40e2e29 → `e5ddd701`. Forge
  deployment 83519795: `Remote database is up to date.` (no migration), app daemon-746791 and worker daemon-801730
  RUNNING, `✓ Deploy complete`.
- **AC-4: pass.** RELEASE.json source_commit `4af4caaf` (== main merge commit), build_id == `.next/BUILD_ID`;
  `/login` 200 with the new BUILD_ID once and the old 0 times; `/api/health` 200; `Workers started: … agent-reply`;
  at 02:44:12Z (4m38s after restart) 0 new error lines in both logs and both pids unchanged.
- **AC-5: pass.** Runbook written; poc-log line added; kanban AGENT-004 review → done with PRs 204, 205. Committed on
  `docs/agent-004-release-records`, PR into develop.

## unverified
- The AGENT-004 behaviour on prod (needs a real diner thread with the omc agent): the owner's live check.

## notes
- `INDEX.md` (deploys section) and `handoffs.md` were not updated: neither is in the brief's `files_allowed`.
- `RELEASE.json` and the Forge log carry a `built_by` email and the seeded admin email; both are redacted in the
  committed evidence (public repo).
