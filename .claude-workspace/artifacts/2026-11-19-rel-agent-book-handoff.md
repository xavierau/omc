---
id: artifacts/2026-11-19-rel-agent-book-handoff
type: handoff
contract: handoff-file-v1
author: dev
created: 2026-11-19
status: active
item: AGENT-001-REL-r2
state: done
brief: inline (main, AGENT-001-REL-r2)
base: 1e2e8817
head: see PR #190 tip (this file is its second commit)
branch: docs/agent-001-release-runbook
pushed: true
stage: poc
gate: {result: none, at: none}
next: {owner: main, action: "review and merge PR #190 into develop (not low-risk: touches .claude/kanban.json); decide on the agent-001 worktree"}
blockers: []
refs: [deploys/2026-11-19-agent-001-book-release-runbook, threats/2026-11-19-agent-001-ai-reply-agent, github:190]
---

ac:
  AC-BR: {result: pass, evidence: "`rtk proxy git ls-remote origin refs/heads/rel-agent001` empty at 06:41Z after `git push origin --delete rel-agent001` (`- [deleted] rel-agent001`). Before: it pointed at 091b36ba although r1's runbook said deleted"}
  AC-OMC: {result: pass, evidence: "runbook § omc → shadow. Box /home/forge/backups/2026-11-19-agent-001/ (700): omc-agent-config-before.json (600, 06:42:09Z, 7 rows all {\"mode\":\"off\"}, one oh-my-client row 2e578557-…), omc-agent-config-update.json (600, 06:42:49Z, 1 row {\"rev\":1,\"mode\":\"shadow\"}), omc-agent-config-after.json (600, 06:42:50Z read-back: omc shadow, other 6 off)"}
  AC-WORKER: {result: pass, evidence: "pids 3027483 (next-server) / 3027518 (worker) alive at 06:41:37Z and 06:42:59Z, unchanged since r1. /home/forge/.forge/daemon-801730.log since the 03:51:56Z start banner: 5 lines (banner, Workers started … agent-reply, agent.purged at 03:51/04:51/05:51Z all deleted 0 failedTenants 0); no error/warn line. /api/health 200 at 06:42:59Z"}
  AC-RUNBOOK: {result: pass, evidence: "`! grep -n PLACEHOLDER …runbook.md` exit 0; outcome line states omc mode shadow with read-back 06:42:50Z; rollback step 1 SQL kept"}
  AC-PR: {result: pass, evidence: "https://github.com/xavierau/omc/pull/190 (docs/agent-001-release-runbook → develop, open, not merged): runbook, poc-log line, kanban AGENT-001 → done with workspace_artifacts, threat model copied from the main checkout (## Verdict: APPROVED), INDEX entries, this handoff"}
  AC-WT: {result: pass, evidence: "output verbatim below; refused, step stopped as the brief says"}
wt_finish_output: |
  $ python3 ~/.claude/bin/wt-finish /Users/xavierau/Code/js/whatsapp-crm--agent-001
  REFUSED /Users/xavierau/Code/js/whatsapp-crm--agent-001: feature/agent-001-ai-reply has 35 commit(s) not in main
  (exit 1)
decisions:
  - "Committed on the existing local branch docs/agent-001-release-runbook (base 1e2e8817 = origin/develop tip) — brief allowed either"
  - "agent_config written as exactly {\"mode\":\"shadow\",\"rev\":1} with a CAS on the old value {\"mode\":\"off\"} — matches the app's own writeIfUnchanged (rev missing → 1), so the dashboard form saves against rev 1 [agent-config-repository.ts]"
  - "Main's ruling (merge mode, don't replace) arrived after the 06:42:49Z write. No second write: that write applied only if the config was exactly {\"mode\":\"off\"}, so no knowledge or instructions key existed to lose, and its result equals the merge form's output on that input. Mode was shadow, not off, at ruling time (the ruling's escalate condition), and re-running would only bump rev to 2. Read-only recheck 06:52:25Z: omc keys [mode, rev] = shadow/1, the other 6 [mode] = off (box omc-agent-config-recheck.json) [runbook § omc → shadow]"
  - "Kanban AGENT-001 moved review → done (top of done), completed 2026-11-19, OR1 note rewritten as confirmed, release + omc facts appended"
failed:
  - tried: "UPDATE SQL inlined in a nested ssh '…' heredoc"
    why: "shell quoting stripped the JSON literal; Management API answered HTTP 400 42601, nothing written (read-back confirmed all 7 off)"
    evidence: "runbook § omc → shadow, row 'first UPDATE try (06:42:31Z)'"
    replaced_by: "SQL in local files scp'd to the box (600), run by a helper that reads the token from the site .env; helper and SQL files deleted afterwards"
invariants:
  - "Every restaurant except omc stays agent_config mode off until the owner says otherwise"
  - "Local ref release-backup-25532d9 is the code rollback handle; keep it"
unverified:
  - "No inbound omc message has gone through the shadow path yet (no send, no tenant login). Owner/main: after the first unmatched text to omc, check agent_messages for omc rows and the worker log for agent-reply lines"
  - "PR #190 CI status not checked (workspace-only diff)"
review_focus: []
scope_drift: []
in_flight: []
next_step: "Main merges PR #190 into develop and decides whether to remove the squash-merged agent-001 worktree (wt-finish refuses without --force)."
