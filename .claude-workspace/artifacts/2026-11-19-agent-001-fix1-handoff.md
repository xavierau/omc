---
id: artifacts/2026-11-19-agent-001-fix1-handoff
type: handoff
contract: handoff-file-v1
author: dev
created: 2026-11-19
status: active
item: AGENT-001-FIX1
state: done
brief: inline (team-lead, AGENT-001 FIX-1) + ruling r2 (team-lead, 2026-11-19: silenced in auto → fallback once)
base: 530331c8
head: r2 fix commit on top of e717984e (see git log; this handoff file is committed with it)
branch: feature/agent-001-ai-reply
pushed: true
stage: poc
gate: {result: pass, at: 2026-11-19}
next: {owner: main, action: "re-review PR #185"}
blockers: []
refs: [plans/2026-11-19-agent-001-ai-reply-agent, threats/2026-11-19-agent-001-ai-reply-agent, artifacts/2026-11-19-agent-001-w1-handoff, artifacts/2026-11-19-agent-001-w2-handoff, kanban:AGENT-001]
---

# AGENT-001 FIX-1 handoff: /code-review findings on PR #185

Evidence folder: `.claude-workspace/artifacts/2026-11-19-agent-001-fix1-evidence/`.
Per-AC test counts come from the round-r2 full-suite JSON run (38 AC-F tests passed, 0 failed), listed in `ac-f-counts.log`.

## ac
- **AC-F1: pass** (6 tests). Red-first is shown twice. `red-first-f1-f3.log`: with the post-call re-check removed, the 3 original F1 tests fail. `red-first-f1-r2.log`: with the r2 fallback lines removed, the 3 silenced-in-auto tests fail. All in `src/application/__tests__/process-agent-reply.test.ts`:
  - Overlapping jobs A and B on one conversation: one send (B). A is recorded `skipped`, reason `superseded`, with `model` set.
  - Job A's handoff during B's in-flight model call: nothing sent by B, outcome `skipped`, reason `silenced`.
  - Ruling r2 case: B (admitted under auto) is silenced by A's handoff, so B sends the fallback menu exactly once. A, superseded, sends nothing. Zero agent sends; the log reasons are `silenced` and `superseded`.
  - An auto-admitted job silenced at job start sends the fallback once with no model call. A shadow-admitted one sends nothing.
  - A run's own handoff does not block its own reply.
  - A superseded shadow job records no draft.
- **AC-F2: pass** (2). `historyTtlHours: 1` clamps to 24; three model rows 2/12/23 h old survive a purge and still trip the 24 h tenant cap (`purge-agent-messages.test.ts`). The UI knob renders `min="24" max="168"` and the `range` hint `{min:24,max:168}` (`agent-dashboard.test.tsx`). The hint already read `AGENT_NUMBER_RANGES`, so no UI code changed.
- **AC-F3: pass** (6, red-first in `red-first-f1-f3.log`). Auto-admitted job with a failed config read: fallback once, outcome `fallback`, reason `config_unavailable`, no model call. Shadow-admitted job with a failed read: `error`, nothing sent. Auto-admitted job with config now off: fallback once, outcome `skipped`, reason `mode_off`. The webhook stamps `admittedMode`. Repo test: `readAgentConfig` returns `{ok:false}` on a query error, while `getAgentConfig` (webhook) still degrades to off.
- **AC-F4: pass** (3). Auto `send_failed`: the fallback is tried once, outcome `fallback`, reason `send_failed`. If the send throws and the fallback also fails: `error`, one attempt each. `no_phone_number`: `error`, no fallback attempt.
- **AC-F5: pass** (4). Worker: a `truncated` failure in auto sends the fallback and nothing partial. Adapter: MAX_TOKENS with text and MAX_TOKENS with thoughts only both map to `truncated`. Every request body (including tool-loop rounds) carries `generationConfig.thinkingConfig: {thinkingLevel: 'low'}`.
- **AC-F6: pass** (5). `maxToolCalls: 0`: the worker passes `tools: []`, the request has no `tools`, and a points question gets a text answer. Once the cap is used up, the next request has no `tools` and a text answer succeeds. Calls past the cap in one round are answered with `{error:'tool_limit_reached'}` and not run. `tool_cap` happens only when the model returns a functionCall although no tools were declared.
- **AC-F7: pass** (7). The same job processed twice, sequentially: the second run returns `duplicate`, nothing is sent and no rows are added. Two concurrent runs: one send, one row. The answer row is stored before `sendText` with `reply_to_message_id` = the user row. A re-run of a fallback job sends no second menu. Repo: 23505 maps to `taken`, and `setModelOutcome` is scoped by id + restaurant + phone. Queue: `lockDuration` 60000, concurrency still 3.
- **AC-F7-MIG: pass.** Throwaway `public.ecr.aws/supabase/postgres:17.6.1.143` container. Storage stubs created as `supabase_admin` (`stubs.sql`), migrations 001..082 applied with ON_ERROR_STOP (82/82, `scratch-083-fix1-apply.log`), then the amended 083 plus assertions inside `BEGIN … ROLLBACK` (`assert-fix1.sql`, `scratch-083-fix1-assert.log`, exit 0). Container removed afterwards. Results:
  - `reply_to_message_id` is a nullable uuid with FK ON DELETE SET NULL.
  - Partial unique index: a second `sent`, `fallback` or `shadow_draft` row for the same user row fails with unique_violation. `skipped` and `error` rows for that user row are allowed, and so are many null rows.
  - Updating `sent` to `fallback` on the claimed row works.
  - A user row with `reply_to_message_id` fails with check_violation.
  - `model IS NOT NULL` counts 4 call rows and excludes `rate_limited`.
  - A purge that deletes the old user row keeps its younger answer, with `reply_to_message_id` nulled.
  - RLS is on with 0 policies, and 7 indexes exist.
  - W1's original 11 assertions also re-run green on the amended 083 (`scratch-083-w1-assert-rerun.log`).
  - The schema-contract test covers the new column, the index over exactly `REPLY_CLAIM_OUTCOMES`, SET NULL and the user-row CHECK, and its filter parser now also reads `.not(`.
- **AC-F8: pass** (3). A `skipped` `window_closed` row with a model counts toward the per-phone cap (the next job is rate_limited) and the per-tenant cap (the webhook gate stops the next message and the worker stops a raced job). Rows without a model call do not count. The repo query is `.not('model','is',null)` with no outcome list.
- **AC-F10: pass** (1). `agent-routing.test.ts`: `isSilenced` and both `countModelCalls` start before any of them resolves, and the admit result is still `queued`.
- **AC-REG: pass.** The full suite ran under the heavy lock twice, once per round. Round r2: 633 files passed, 10 skipped; 7059 tests passed, 0 failed (`full-suite.log`). Round 1: 7057 passed, 0 failed. The known-flaky WAQ files did not fail in either run.
- **AC-GATE: pass.** `tsc --noEmit` ran under the heavy lock. In round 1 the first run found a test-only typing error in `agent-reply-queue.test.ts:52`; I fixed it and the re-run exited 0. After the r2 change it exited 0 again (`tsc.log`). ESLint is clean on every touched file.
- F9 (no AC): `changeAgentConfig`, its `CAS_ATTEMPTS`/`ConfigChange` orphans and its test are deleted. `saveAgentSettingsAtRev` is the only write path. No reference to it remains (grep).

## decisions
- **Silenced in auto, ruling r2 (team-lead 2026-11-19, which replaces the brief's F1 "send nothing"):** an auto-admitted job that ends silenced, at job start or at the post-call re-check, sends the fallback menu once. The outcome stays `skipped`, reason `silenced`. This applies R4 and matches the webhook's silenced path. A superseded job still sends nothing, because the newer job owns the response. Code: `process()` (start check) and `answer()` (post-call re-check) in `process-agent-reply.ts`.
- **Own-handoff exclusion (F1, accepted in ruling r2):** the post-call silence re-check ignores a silence this run's own `handoff_to_staff` set. Without it, every handoff reply would block itself. It is tracked by wrapping `silenceUntil` in the run's tool executor. `AgentToolContext.silences` is narrowed to `Pick<…,'silenceUntil'>`.
- **Mode matrix (F3, accepted in ruling r2):** the worker runs at `min(admittedMode, current mode)` and owes a fallback if and only if the job was admitted under `auto`.
  - Admitted auto, now shadow: the draft is stored and the suppressed menu is sent (reason `mode_changed`).
  - Admitted shadow, now auto: draft only, because the diner already got the menu.
  - Any failure (model, send, config read, unexpected throw) falls back on `admittedMode`, not on the current config.
  - Revert point: `effectiveMode` in `process-agent-reply.ts`.
- **F7 claim mechanism:** insert-first. `recordModelRow` now returns `{inserted, id} | {taken}`. The `sent`/`fallback`/`shadow_draft` row is inserted before the side effect. If the send fails, `setModelOutcome` rewrites it to `fallback` or `error`, and the reply text is kept for grading, as W1's `send_failed` row did. The claim does not cover outcomes outside the index: a re-run of a `skipped`/`error` job can add a second such row and make a second model call. That is rare (a stall) and left as is.
- **FK ON DELETE SET NULL, not CASCADE:** an answer row is seconds younger than its user row. CASCADE would delete it with the user row and undercount the 24 h cap. SET NULL keeps it until its own `created_at` passes the TTL.
- **F6: tools omitted rather than `functionCallingConfig.mode NONE`,** as the brief asked. Probed live once on `gemini-3.1-flash-lite`: a request with no `tools` after a functionCall/functionResponse round trip returned 200 with text (`probe.log`). The same probe on `gemini-3.8-flash` got 503 "high demand" and is unverified there. A round where the model asks for more calls than the cap allows: the excess calls get an error response, so every functionCall still has its functionResponse.
- **F5 thinking control:** `thinkingLevel: 'low'`. Source: ai.google.dev/gemini-api/docs/generate-content/thinking (via context7 `/websites/ai_google_dev_gemini-api`, 2026-11-19). That page's table says `minimal` is "Not supported (error)" on Gemini 3.8 Flash, so `low` is its lowest level; `low` is also supported on 3.6 Flash, 3.5 Flash and 3.1 Flash-Lite (env/tenant overrides). `thinkingBudget` is not sent: the doc says level + budget together is a 400. The live probe accepted `low` on 3.1-flash-lite.
- **F1 re-check code is separate** from the start-of-job check (`interruptedAfterCall`, which issues both reads together). Sharing it would reorder the start checks (silence before mode off) and change the `mode_off` fallback.
- **`MODEL_CALL_OUTCOMES` removed** (now an orphan). It is replaced by `REPLY_CLAIM_OUTCOMES`, which the fake store and the schema-contract test both read.

## failed
- tried: "storage stubs as the `postgres` user on the supabase image"
  why: "`postgres` is not superuser there: permission denied for schema storage"
  evidence: "first scratch run stopped at 032_campaign_images.sql"
  replaced_by: "stubs created as supabase_admin, tables owned by postgres, migrations applied as postgres"

## invariants
- The worker owes the diner one response if and only if `job.admittedMode === 'auto'`. The webhook stamps it; the worker never derives it from the current config.
- Every answer row (`sent`/`shadow_draft`/`fallback`) is inserted before its side effect and carries `reply_to_message_id`. The partial UNIQUE index is the idempotency guard, not a read.
- Every row written after a model call has `model` set, so it counts toward R6.
- `historyTtlHours` ≥ 24 h (the longest limit window).

## unverified
- **Tool omission after a function call on `gemini-3.8-flash`**: the live probe got 503. Verified only on 3.1-flash-lite. Owner: next live run / I-task.
- **Real BullMQ stall re-run** with `lockDuration` 60 s: unit-tested with a mocked bullmq only. Owner: I-task on the local stack.
- **Real PostgREST encoding** of `.not('model','is',null)` and of `insert(...).select('id').single()` mapping 23505 to `taken` on the partial index: SQL semantics proven on the scratch DB, PostgREST only through a recording client. Owner: I-task / prod smoke.

## review_focus
- `src/application/agent/process-agent-reply.ts`: `effectiveMode`, `Run.claim`/`finish`, `interruptedAfterCall`, `deliver` (claim → send → fallback on failure), `process` (config Result, mode_off fallback).
- `src/infrastructure/gemini/agent-client.ts`: the `withTools` loop and over-cap responses, `truncated`, `thinkingConfig`.
- `supabase/migrations/083_agent_reply.sql`: `reply_to_message_id`, `agent_messages_one_reply_key`, role-shape CHECK.
- `src/infrastructure/supabase/repositories/agent-message-repository.ts`: `recordModelRow` claim, `setModelOutcome`, `countModelCalls`.

## scope_drift
- None. Every changed file is inside files_allowed. `src/test-utils/recording-supabase.ts` lacks `.not`, and it is outside files_allowed, so the `countModelCalls` test builds its own small recording chain instead of extending it.

next_step: "Re-review PR #185."
