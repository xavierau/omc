# AGENT-001 review round FIX-1: the "exactly one response" guarantee (PR #185)

Date: 2026-11-19. Branch `feature/agent-001-ai-reply` (PR #185), unreleased. Ten `/code-review`
findings on the W1/W2 reply agent; each broke either R4 (in auto a diner gets exactly one
response per message, agent reply or fallback menu) or the R6 cost caps. Grouped by root cause.

## 1. The worker re-derived state the webhook had already acted on (F3, and the mode matrix)

- **Problem:** a config read error in the worker resolved to the defaults (mode off), so an
  auto-admitted message (menu already suppressed by the webhook) got nothing. Same for a tenant
  switched to off (or shadow) during the 3 s debounce.
- **Root cause:** the job carried no record of what the webhook decided; the worker read the
  config again and treated "unreadable" as "off".
- **Fix:** the job carries `admittedMode`; the worker reads config as a Result
  (`readAgentConfig`), owes a fallback iff `admittedMode === 'auto'`, and runs at
  `min(admittedMode, current mode)`.
- **Prevention:** when two stages split one decision, pass the first stage's decision in the
  message; never let a read failure collapse into a mode (memory principle_result_type_over_nullable_port).

## 2. Checks done once, before a slow step, in a concurrent worker (F1, F7)

- **Problem:** jobs of one conversation overlap (concurrency 3, model calls up to 20 s); latest-wins
  and the handoff silence were checked only before the model call, so two replies could go out.
  A BullMQ stalled re-run (30 s default lock) could send the same reply twice.
- **Root cause:** check-then-act with a multi-second gap, and no DB guard on "one answer per
  inbound message".
- **Fix:** re-check latest-wins and silence after the model call (a run's own handoff excluded);
  `reply_to_message_id` with a partial UNIQUE over sent/shadow_draft/fallback, row inserted
  before the send (claim-first); worker lockDuration 60 s.
- **Prevention:** for any side effect behind a slow call, guard with a DB constraint, not a read.

## 3. Failure paths that ended in silence (F4, F5, F6)

- **Problem:** a failed send recorded `error` with no fallback; a MAX_TOKENS answer (thinking ate
  the budget, or a cut-off sentence) could be sent or end as `empty`; at the tool cap the run
  failed instead of letting the model answer in text.
- **Fix:** send_failed → fallback once; `truncated` failure + `thinkingLevel: 'low'`; tools are
  omitted once `maxToolCalls` is used (probed live: Gemini accepts a no-tools request after a
  function-call round trip).

## 4. Limits and retention disagreed (F2, F8)

- **Problem:** a 1 h TTL purged rows the 24 h tenant cap counts; skipped-after-a-call rows did not
  count at all.
- **Fix:** `historyTtlHours` ≥ 24; count rows with `model IS NOT NULL`, any outcome.
- **Prevention:** a retention window must cover every window that reads the same rows.

Evidence: `.claude-workspace/artifacts/2026-11-19-agent-001-fix1-evidence/`.
