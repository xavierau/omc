---
id: artifacts/2026-11-19-book-003-merge-develop-r4
type: artifact
author: dev (BOOK-003 r4)
created: 2026-11-19
status: active
supersedes: null
superseded_by: null
related: [artifacts/2026-11-19-book-003-review-fixes-r3, threats/2026-11-19-agent-booking-poppy, kanban:BOOK-003]
---
# BOOK-003 r4: develop (AGENT-001) merged into PR #186

Base c09018f (r3, local only). origin/develop at 1e2e881. Branch `feature/book-003-agent-booking`, remote was 0d95fd0 (an ancestor of c09018f), so the push is a fast-forward.

## Commits
- `c9ca90c` merge origin/develop (merge commit, no rebase).
- `262148e` threat model copied from the main checkout (lines 127–128: per-phone lockout "Accepted for the POC by Xavier, 2026-11-19").
- `7ae078c` this artifact + evidence (first push, fast-forward from 0d95fd0).
- `3b06b12` merge origin/develop again: develop moved to 4a9b564 (#190, AGENT-001 release docs) after the first fetch, and GitHub reported CONFLICTING. The conflicts in `.claude-workspace/INDEX.md` and `.claude-workspace/poc-log.md` were concurrent appends, so both sides were kept. `poc-log.md` is outside `files_allowed`, but only develop's line and BOOK-003's existing line were kept; nothing was authored.
- `3a5dfae` merge origin/develop again: d841ed9 (#191, AGENT-001 deploy docs), no conflicts.
- No change under `src`, `supabase`, `scripts` or the configs since 7ae078c, so the gate logs below still hold for the final head.

## Conflicts
- `src/app/api/webhooks/whatsapp/handlers.ts`: import block only. Both `maybeHandleBookingConfirmCode` and `maybeQueueAgentReply` imports kept. Dispatch order unchanged: `maybeHandleBookingConfirmCode` (dispatchRoute, line 102) runs before `resolveRoute` (line 104), so before `maybeQueueAgentReply` (dispatchConfirmation, `route === null`, line 207).
- `.claude-workspace/ui-map/testid-registry.md`: both sides' rows kept (BOOK-003 booking-agent / via-agent, AGENT-001 agent-settings / agent-log).
- Auto-merged `.claude/kanban.json`, `src/messages/en.json`, `src/messages/zh-HK.json`, `.claude-workspace/INDEX.md`: parse as JSON; the only lines removed versus either parent are comma-only rewrites of the same line (`updated_at` takes 2026-11-19). BOOK-003 and AGENT-001 each appear once in kanban.

## AC-4 proof
No existing test asserted the agent entry point is untouched (booking-confirm-code.test.ts leaves agent-handler real; agent-routing.test.ts has no confirm code). Test files are outside `files_allowed`, so the proof lives in the evidence folder with its own vitest config:
- `evidence/2026-11-19-book-003-r4/ac4-confirm-code-vs-agent.test.ts` (3 tests): live code from the booking phone → promoted, one message, `maybeQueueAgentReply` not called; same code from another phone → agent path; free text → agent path.
- Run: `npx vitest run --config .claude-workspace/artifacts/evidence/2026-11-19-book-003-r4/vitest.ac4.config.ts` → 3 passed (`ac4-proof.log`).
- Red check: with line 102 disabled, test 1 fails (`ac4-red-check.log`); file restored from HEAD.
- Not in CI: vitest's include is `src/**` and `scripts/**`. Promoting it into `src/app/api/webhooks/whatsapp/__tests__/` is a one-file move once that path is allowed.

## Gates (evidence folder)
- `touched-files.log`: webhook `__tests__/` (all), process-agent-reply, agent-tools, booking `__tests__` → 34 files, 594 tests, exit 0.
- `eslint-handlers.log`: exit 0.
- `full-vitest.log` (heavy lock): 642 passed / 11 skipped files, 7202 tests passed, exit 0.
- `tsc.log` (heavy lock): exit 0.
- Push and PR state: `push-and-pr.log` records the pushes up to 3a5dfae. The final head is this artifact's own commit; its ls-remote SHA, `gh pr view 186` mergeable state and CI conclusions are in the dev handoff block (a commit can't record its own SHA).

## AC-5 (push and PR)
- The repo has no `.github/workflows`, so CodeRabbit (a StatusContext) is the only check on PR #186.
- At b2f88e3: ls-remote == HEAD; `gh pr view 186` → MERGEABLE, CLEAN, headRefOid b2f88e3, CodeRabbit SUCCESS (`push-and-pr.log`).
- This section is committed on top of b2f88e3. The handoff block records that commit's ls-remote SHA and PR state.
