---
id: artifacts/2026-11-19-agent-001-w2-handoff
type: handoff
contract: handoff-file-v1
author: dev
created: 2026-11-19
status: active
item: AGENT-001-W2
state: done
brief: inline (team-lead, AGENT-001 W2 brief-v1)
base: f3338ed5
head: 1981b56a (code; this handoff file is committed on top)
branch: feature/agent-001-ai-reply
pr: https://github.com/xavierau/omc/pull/185 (into develop, not merged)
stage: poc
gate: {result: pass, at: 2026-11-19T02:42Z}
next: {owner: main, action: "review PR #185 (W1 + W2), confirm OR1 billing tier, then release"}
blockers: []
refs: [plans/2026-11-19-agent-001-ai-reply-agent, threats/2026-11-19-agent-001-ai-reply-agent, artifacts/2026-11-19-agent-001-w1-handoff, kanban:AGENT-001, kanban:AGENT-002]
---

# AGENT-001 W2 handoff: settings UI/API, conversation log, local-stack walk (POC)

Evidence: `.claude-workspace/artifacts/2026-11-19-agent-001-w2-evidence/` (logs `i1-0N-*.log`, `ac-*.log`,
`shots/` with screenshots and `audit-summary.json`, `tools/` = the walk scripts). Fake tenants, fake member
`+85290000001`, fake admin/staff users only. Nothing touched prod or any real tenant.

## ac
- **AC-W2-API: pass** (20 tests: `pnpm exec vitest run -t 'AC-W2-API'`, `ac-w2-api.log`). Red first: the route
  test ran before the route existed and failed (`ac-w2-api-red.log`). Route tests
  (`src/app/api/dashboard/settings/agent/__tests__/agent-settings.route.test.ts`): member GET → resolved config,
  rev, `canEdit` false; admin `canEdit` true; read error → 500; non-admin PUT → 403, nothing saved; stale rev
  → 409 `{error:'stale', rev}`; temperature 5 / maxReplyChars 99999 / debounceMs -10 / maxToolCalls 2.6 /
  9,000-char knowledge / blank disclosure → clamped by `resolveAgentConfig` and listed in `adjusted`;
  unsent knobs keep their stored value; bad body → 400. Repository CAS tests
  (`agent-settings-repository.test.ts`): write guarded on `agent_config->>rev`, rev+1; stale → no write;
  race lost → stale, no retry; never-revised config (rev 0) guarded on `IS NULL`. Live: a PUT with rev 0
  against stored rev 1 → 409 (`i1-05-r7-live.log`).
- **AC-R7: pass** (7 tests: `-t 'AC-R7'`, `ac-r7.log`; real repository over the recording client, so the
  WHERE is asserted). Non-admin → 403 with no query; list query has `eq:restaurant_id=<tenant>` and selects no
  text; tenant B admin with tenant A's key → 404, the lookup was `eq:id=<key>, eq:restaurant_id=rest-b`;
  non-UUID key → 404 without a query; responses carry `•••• 4567`, never the full phone. Live on the local
  stack: admin A list and own thread contain no full phone and no tenant B key; tenant B's key → 404; staff
  → 403 on both log routes and on PUT; staff GET settings → `canEdit=false`.
- **AC-UI: pass** (evidence: screenshots). Shadow + knowledge saved through the UI and survived a reload
  (`i1-02-settings-shadow.log`; DB row mode shadow, rev 1, 176 chars). `/dashboard/agent` reached by
  clicking the sidebar entry "AI agent", one thread (`•••• 0001`, Draft), detail with diner text and draft
  (`i1-04-log-shadow.log`). Layout audit at 1280 and 390 on setup (collapsed and expanded Advanced), log list
  and detail: 0 blocking (`shots/audit-summary.json`). Warnings: native radio/checkbox touch targets
  (same as the booking section), the pre-existing setup tabs spacing, list/detail row alignment.
  Two layout fixes made during the walk: disclosure input → 2-row textarea (the audit's one blocking
  finding, a value clipped 4px at 390), knob/model labels → block (they sat inline with their input).
  Render tests: `src/components/dashboard/__tests__/agent-dashboard.test.tsx` (9, incl. every used i18n key
  exists in en and zh-HK).
- **AC-I1: pass** (evidence: logs). Local Supabase (CLI 2.109, migrations 001..083 = 83 rows), Redis 7 in a
  throwaway container, `next dev` and the real `scripts/start-worker.ts` process, Kapso intercepted at the
  provider (`tools/kapso-capture.cjs`: a `--require` preload that records every `api.kapso.ai` fetch and
  answers 200), `AGENT_MODEL=gemini-3.1-flash-lite`, signed webhooks (HMAC-SHA256, `tools/wh.mjs`).
  - Shadow (`i1-03-shadow.log`): "你好，請問你哋幾點開門？" → 200; fallback button menu captured; `user` row
    (wamid stored) + `shadow_draft` row "你好！我哋每日嘅營業時間係朝早 11 點至夜晚 10 點。" (1,578 ms,
    worker log `agent.reply` with no text/phone), ~3 s debounce; draft visible at `/dashboard/agent`.
  - Auto (`i1-06-auto.log`): mode switched in the UI; "我而家有幾多積分？夠唔夠換杯咖啡？" → one captured
    text send "你好！你目前有 120 分，足夠換一杯咖啡（需要 100 分）。你可以去櫃檯進行兌換。\n\n🤖 自動回覆
    Automated reply", no menu; row `sent`, tools `{get_member_summary,list_rewards}`, 2,205 ms.
  - Forced failure (`i1-07-bad-model.log`): model pinned to `gemini-0-nope` through the Advanced field →
    exactly one capture, the fallback menu; row `fallback`, reason `http`, 467 ms. Pin cleared afterwards.
  - Real Gemini calls: 3 runs (shadow 1, auto with one tool round, the failing id) — well under 15.
- **AC-GATE: pass.** `python3 ~/.claude/bin/resource-lock.py heavy -- pnpm exec tsc --noEmit` exit 0 at
  2026-11-19T02:42Z, run once (`tsc.log`, empty output). ESLint on every touched file: clean. Touched-file
  vitest: 55 files / 647 tests (`ui-tests.log`). Full vitest suite not run (not in the brief).

## decisions
- **Thread key = id of the thread's newest row** (UUID). Opaque, resolved server-side by
  `findAgentThreadPhoneForRestaurant(restaurantId, key)` (`WHERE id AND restaurant_id`). A key stays valid
  while its row is inside the retention TTL; the list hands out the newest key each load. No new secret.
- **CAS rev contract**: GET returns `rev` (0 for a config never written with a rev); PUT body is
  `{rev, config}`; `saveAgentSettingsAtRev` never retries (a retry would apply a form filled against an
  older config). Added next to W1's `changeAgentConfig` as a seam; W1's function is unchanged.
- **Clamping reported, not silent**: `mergeAgentSettings` (domain service) merges the submitted fields onto
  the stored config, runs `resolveAgentConfig`, returns `adjusted` (submitted keys whose stored value
  differs). The UI shows "Adjusted to the allowed range: …".
- **Setup page**: section rendered for admins only (as booking); a settings read error renders the
  section's error state instead of a form primed with defaults.
- **Log window**: last 7 days, at most 2,000 rows per list load, 200 messages per thread.
- **Nav entry** "AI agent" / "AI 助手" is shown to every member (the sidebar has no role); staff get the
  "only an admin can read…" state (walked).
- **Kapso mock**: a fetch preload in the walk scripts (no repo change); the repo has no committed fake
  provider (the 2026-06-10 mock work was never committed).

## failed
- tried: "plain `<Input>` for the disclosure line"
  why: "layout audit at 390: the default value is clipped 4px in a 236px input (blocking)"
  evidence: "first shots run, setup-advanced-390 blocking 1"
  replaced_by: "2-row textarea; re-audit 0 blocking"

## invariants
- Every conversation-log query filters `restaurant_id` in SQL; the list selects no text; no response
  carries a full phone (AC-R7 tests).
- Settings PUT writes only at the loaded rev; clamping happens only in `resolveAgentConfig`.
- `.from('agent_messages')` stays literal in the new repository (added to the schema-contract test).

## unverified
- **zh-HK screens**: walked in en only; zh-HK keys exist (render test), not screenshotted. Owner: main.
- **AC-LIVE on `gemini-3.8-flash`** and the prod key's tier (OR1) — unchanged from W1. Owner: Xavier.
- **`next dev` rewrites the repo `CLAUDE.md`** (Next 16.3 "agentRules" appends a nextjs block on every
  start). I restored it after the walk and did not commit it (rule file, outside files_allowed). Disable
  with `agentRules: false` in next.config, or accept the block — owner's call.

## review_focus
- `src/app/api/dashboard/settings/agent/route.ts` — rev/config body contract, `adjusted`.
- `src/infrastructure/supabase/repositories/agent-config-repository.ts` `saveAgentSettingsAtRev`.
- `src/infrastructure/supabase/repositories/agent-conversation-repository.ts` + the two log routes (R7).
- `src/hooks/use-agent-settings.ts` `toAgentPayload` (blank number left out, blank model → null).

## scope_drift
- none. All changes inside files_allowed. `CLAUDE.md` was modified by `next dev`, restored, not committed.

next_step: "Main: review PR #185, decide the CLAUDE.md agentRules question and OR1, then release (migration 083 before deploy; worker restart covers the new queue)."
