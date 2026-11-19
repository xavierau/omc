---
id: artifacts/2026-11-19-agent-001-w1-handoff
type: handoff
contract: handoff-file-v1
author: dev
created: 2026-11-19
status: active
item: AGENT-001-W1
state: done
brief: inline (team-lead, AGENT-001 W1)
base: 7642764c
head: ffe423fb (code; this handoff file is committed on top)
branch: feature/agent-001-ai-reply
pushed: true
stage: poc
gate: {result: pass, at: 2026-11-19T01:58Z}
next: {owner: main, action: "review PR, then W2 (settings API/UI + conversation log + I-task)"}
blockers: []
refs: [plans/2026-11-19-agent-001-ai-reply-agent, threats/2026-11-19-agent-001-ai-reply-agent, kanban:AGENT-001]
---

# AGENT-001 W1 handoff: AI reply agent backend (POC)

## ac
Test counts are from one JSON-reporter run of the 10 agent test files (150 tests, 0 failed) and one
`pnpm exec vitest run -t 'AC-(R1|…|MIG) '` run over the whole repo (131 matched, 0 failed).

- **AC-R1: pass** (10 tests, red-first shown: with the hook reverted, 4 of the 10 fail).
  `src/app/api/webhooks/whatsapp/__tests__/agent-routing.test.ts`. Shadow → 1 insert + 1 enqueue + fallback menu; auto → 1 insert + 1 enqueue (delay = debounceMs), no fallback; `createGeminiAgentClient` never constructed and no fetch to generativelanguage in the request path; off / silenced / over-limit / enqueue failure / admit error → fallback; webhook retry → nothing.
- **AC-R2: pass** (6). `src/application/__tests__/agent-tools.test.ts` (injected `phone`, `restaurant_id`, `member_id` args ignored; declarations have no parameters) + `src/infrastructure/supabase/repositories/__tests__/agent-repositories.test.ts` (recording client: `members` WHERE `restaurant_id = job restaurant AND phone = job phone`; stamp cards WHERE restaurant + that member).
- **AC-R3: pass** (12). Unknown and disabled tools → `{error:'tool_not_available'}`, no impl, no silence row; adapter loop echoes the error functionResponse and ends with text; endless tool calls → `tool_cap`; `maxToolCalls: 0` → `tool_cap` with nothing run.
- **AC-R4: pass** (28). Worker: each of timeout/http/safety/parse/empty/tool_cap → auto sends the fallback exactly once (outcome `fallback`), shadow sends nothing (outcome `error`); an unexpected worker error in auto also falls back once. Adapter: HTTP 503/400/network → http, promptFeedback/finish SAFETY/PROHIBITED_CONTENT → safety, non-JSON/no candidates/MALFORMED_FUNCTION_CALL → parse, blank or thought-only text → empty, hung call → timeout at perCallTimeoutMs, 20 s budget → timeout, no key → http.
- **AC-R5: pass** (8). Purge: per-tenant TTL (72 h default, 24 h tenant, mode-off tenant still purged), expired silences purged, one failing tenant does not stop others; history: only rows inside the TTL, own conversation, user rows + `sent`/`shadow_draft` replies, newest N returned oldest first; repo query shape (`gte created_at`, `order desc`, `limit N`, `delete … lt created_at`); hourly `upsertJobScheduler` registration.
- **AC-R6: pass** (7). 11th message in an hour → no model call (worker), fallback once then quiet; webhook gate stops it before a job in auto; two inbound inside debounce → one model call that sees both texts; tenant daily cap (other tenants' rows not counted); shadow over-limit sends nothing; enqueue delay = debounceMs, one attempt.
- **AC-R8: pass** (1 end-to-end + purge log check). Log spy over admit → worker with two tool calls → send, then a timeout → fallback: serialized logs contain neither the inbound text, the phone (with or without `+`), an injected tool-arg phone, nor the API key; the `agent.reply` line has exactly `messageId, restaurantId, outcome, latencyMs, promptTokens, outputTokens, toolCalls`.
- **AC-R9: pass** (8). Stored model row per outcome: sent / shadow_draft / fallback / skipped (window closed, silenced, mode switched off) / error (send failed) / rate_limited; outcome always in the enum; `tool_calls` names only; model id + latency on model runs; `wamid` null on model rows.
- **AC-R10-R11: pass** (7 + 4). 5,000-char model text → sent text (reply + blank line + disclosure) ≤ 600 code points and stored text ≤ 600; shadow draft uses the same bound; auto send ends with `🤖 自動回覆 Automated reply`; reworded disclosure used; blank disclosure falls back to the default (cannot be removed).
- **AC-VO: pass** (34). Garbage/partial/hostile JSON → defaults, never throws; every numeric knob clamped to its range; non-finite → default; knowledge ≤ 8000, instructions ≤ 2000; enabledTools filtered to known names; model id restricted to `^[a-z0-9][a-z0-9.-]{0,63}$` (it goes in the URL path); effective model = tenant pin → env `AGENT_MODEL` → `gemini-3.8-flash`.
- **AC-MIG: pass.** (a) Scratch DB: throwaway `public.ecr.aws/supabase/postgres:17.6.1.143` container (auth/roles/extensions built in; stubbed `storage.buckets`, `storage.objects`, `storage.foldername()`; `supabase_realtime` publication present), migrations 001..082 applied with `ON_ERROR_STOP` (82/82), then 083 + 11 assertions inside `BEGIN … ROLLBACK`, container removed. Results: existing restaurants backfilled `{"mode":"off"}`; RLS `t` on both tables, 0 policies; mode CHECK rejects `bogus`; duplicate `(restaurant_id, wamid)` → unique_violation, same wamid on another tenant allowed; role-shape CHECKs reject a user row with outcome, a model row without outcome, an unknown outcome, a user row without text; `authenticated` and `anon` see 0 rows, `service_role` sees 4; history SQL returns own conversation inside TTL, sent reply kept, rate_limited excluded, newest first; purge deletes only the >72 h row; silences upsert updates in place on `(restaurant_id, phone)`; restaurant delete cascades; 6 indexes present. Log: scratchpad `scratch-083-assert.log` (not in repo). (b) Schema-contract test `src/infrastructure/supabase/repositories/__tests__/agent-schema-contract.test.ts` (10 tests): every selected/written/filtered column of the three agent repositories exists in the migrations SQL, the planned column sets, RLS on + no POLICY/GRANT in 083, outcome CHECK == domain enum.
- **AC-LIVE: pass on `gemini-3.1-flash-lite`; NOT achieved on the default `gemini-3.8-flash`.**
  Model ids verified with `GET v1beta/models` (key from `.env.local`): `gemini-3.8-flash` is listed with `generateContent` (so it stays the default; no fallback pick needed), as are `gemini-3.5-flash`, `gemini-3.1-flash-lite` and others.
  Script (session scratchpad, not in repo): `agent-live-check.ts` drives the real adapter + real tool executor + real system prompt with fake tool data (restaurant `demo-rest`, phone `+85200000000`, 120 points, no PII), question `我而家有幾多積分?夠唔夠換杯咖啡?`, knowledge "Demo Cafe … 100 points = free coffee".
  Result on `gemini-3.1-flash-lite` (after the rule-6 tweak): `ok: true`, toolCalls `[get_member_summary, list_rewards]` (both executed through the bound executor), 2,175 ms, 1,166 prompt / 57 output tokens, sent text `你目前有 120 分，足夠換領一杯咖啡（需要 100 分）。你可以到店內向職員查詢兌換詳情。\n\n🤖 自動回覆 Automated reply`. The functionCall → verbatim model turn (with thoughtSignature) → functionResponse{id,name} round trip works against the live API.
  On `gemini-3.8-flash`: 20 attempts 01:56–02:07Z through the adapter, all failed — 503 `UNAVAILABLE` "high demand" (→ `http`) or 8 s `timeout`; a raw curl at 02:08Z then returned **429 `RESOURCE_EXHAUSTED`: `generate_content_free_tier_requests`, limit 20/day per model, quotaId `GenerateRequestsPerDayPerProjectPerModel-FreeTier`**, retry in ~5.9 h. My retries used up that free-tier daily quota for 3.8-flash on this key.
  **This answers OR1: the `.env.local` GEMINI_API_KEY project is on the FREE tier** (prompts may be used by Google; 20 req/day on 3.8-flash). Whether the prod key is the same project was not checked.
- **AC-GATE: pass.** `python3 ~/.claude/bin/resource-lock.py heavy -- pnpm exec tsc --noEmit` exit 0 at 2026-11-19T01:58Z (the first run found two test-file type errors; fixed, re-run once). Full vitest suite once under the heavy lock: 629 files passed, 6986 tests passed, 0 failed. ESLint on every touched file: clean.

## decisions
- **Silence storage: new table `agent_silences (restaurant_id, phone) PK, silenced_until`** — the lesser change. `conversation_windows` has one row per 24 h service window (a new row is inserted when a window expires) and a sole-writer invariant (WAQ-008), so a 12 h silence stored there would be lost on the next window and would break that invariant. [decide_yourself]
- **Tool loop lives in the adapter** (`AgentModelPort.respond` takes an `executeTool` callback) because the brief's port Result includes `tool_cap`; the executor (application) owns R2/R3. The model turn is appended verbatim so Gemini's `thoughtSignature` round-trips (probed live: function calls carry one).
- **Rate limits count model rows whose outcome cost a model call** (`shadow_draft|sent|fallback|error`), per phone/hour and per tenant/day. Auto mode is gated in the webhook too (brief: skip handleUnknown unless silenced or over limit): over limit → a `rate_limited` row + fallback the first time in the hour, then quiet, no job. The worker re-checks (race inside the debounce).
- **History = user rows + `sent`/`shadow_draft` model rows**; consecutive same-role rows merge into one turn; a window that starts on a model row drops it (Gemini contents start with the user).
- **Reply bound reserves room for the disclosure**: reply ≤ `maxReplyChars − 2 − len(disclosure)` code points, so the whole sent message ≤ `maxReplyChars` (AC-R10 reads both "sent" and "stored" ≤ 600). Shadow drafts use the same bound.
- **Window closed in auto → outcome `skipped`, draft text kept**; send failure → `error`, no fallback (the channel itself failed); missing key → `http` (configuration error of the HTTP integration; no separate enum value).
- **Fallback sender injection**: `handleUnknown` lives in the webhook adapter; the worker gets it through `agentReplyWorkerHandlers()` in `src/app/api/webhooks/whatsapp/agent-handler.ts`, called from `scripts/start-worker.ts` (composition root). The application layer never imports `@/app`.
- **Debounce = BullMQ delayed job + latest-wins**: job id `agent-<restaurant>-<row id>`, one attempt (a retry could double-reply). A superseded job writes no row.
- **No member name, member id or phone reaches Gemini**: `get_member_summary` returns `{member, pointsBalance, stampCards[{campaign, stamps, stampsRequired}]}`; there is no "tier" in the schema, so the tool reports points + stamp cards only.
- **Safety preamble wording**: `src/application/agent/agent-prompt.ts` (6 rules; tenant instructions are labelled "tone only" and come after). Rule 6 was tightened after the live run: the lite model offered "do you want to redeem?", which it cannot do.
- **Stored user text cut at 2,000 chars** (`USER_TEXT_MAX_CHARS`).
- **No new npm dependency** (REST fetch, like decisions-client.ts).

## failed
- tried: "scratch DB as a separate database inside the supabase image"
  why: "`auth`/`supabase_realtime` exist only in the image's `postgres` database; template1 lacks them"
  evidence: "011 failed: schema auth does not exist"
  replaced_by: "apply migrations into the throwaway container's `postgres` DB, 083 + assertions in BEGIN…ROLLBACK"

## invariants
- The webhook path never constructs the Gemini client (AC-R1 test asserts it).
- Every agent query is scoped by `restaurant_id`, and by `phone` for one conversation; tools never read model args.
- `agent_messages` / `agent_silences`: RLS on, no policies; reads go through server code only (W2's log route must scope by tenant in SQL).
- `.from('agent_messages')` stays a string literal: the schema-contract parser reads it.

## unverified
- **AC-LIVE on `gemini-3.8-flash`** — free-tier quota exhausted / 503; re-run once the key's project has billing (OR1). Owner: Xavier / main.
- **Prod GEMINI_API_KEY tier** — not checked; if it is the same free-tier project, shadow on a real tenant violates OR1 and 20 req/day caps the agent far below `maxRepliesPerTenantPerDay` 500. Owner: Xavier.
- **Real Redis / BullMQ run of the worker** (delay, latest-wins, job scheduler) — unit-tested with a mocked bullmq; W2's I-task walks it on the local stack. Owner: W2.
- **Real PostgREST** for the new repositories (`.or(...outcome.in.(…))`, partial-unique 23505, `upsert onConflict 'restaurant_id,phone'`, `delete({count})`) — SQL semantics proven on the scratch DB, PostgREST encoding only via the recording client. Owner: W2 I-task / prod smoke.
- **`maxOutputTokens: 400` with thinking models**: Gemini counts thought tokens against the budget; a long think could end with MAX_TOKENS and no text → `empty` → fallback. The live lite run used 52 output tokens. Watch `outputTokens` and `reason: empty` in the shadow logs.
- **OR1 (Gemini billing tier): the dev key is FREE tier** (429 quota body above) — billing must be enabled on the key's project before shadow is set on any real tenant (threat model verdict CONDITIONAL). Owner: Xavier.

## review_focus
- `src/app/api/webhooks/whatsapp/handlers.ts:201` — the hook: text only, after the booking router, before handleUnknown.
- `src/application/agent/admit-inbound-for-agent.ts` — auto-mode gate and the fail-toward-fallback catch.
- `src/application/agent/process-agent-reply.ts` — order of checks; `Run.fallback()` once-guard; the catch that falls back in auto.
- `src/infrastructure/gemini/agent-client.ts` — tool loop, verbatim model turn, functionResponse id/name echo, failure mapping.
- `src/application/agent/agent-tools.ts` — executor ignores args, refuses unknown/disabled tools.
- `supabase/migrations/083_agent_reply.sql` — CHECKs and indexes.

## scope_drift
- none. All files are inside files_allowed (`scripts/start-worker.ts` is the only script touched; the live-check script lives in the session scratchpad, outside the repo).

## Deploy notes for W2 / release
- `scripts/start-worker.ts` starts the new `agent-reply` worker and registers the hourly purge scheduler; deploy.sh's existing `restart_daemon "worker" "start-worker"` restarts it. In auto mode a stopped worker means diners get no reply (the webhook skips the fallback), so the worker daemon must be up before any tenant goes auto.
- Migration 083 must be applied before deploy; `agent_config` defaults every tenant to off, so shipping the code changes nothing until a tenant's mode is set.
- `AGENT_MODEL` is optional (empty → `gemini-3.8-flash`).

next_step: "Review PR, confirm OR1, then dispatch W2 (settings API/UI, /dashboard/agent log, I-task on the local stack)."
