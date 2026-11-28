---
id: artifacts/2026-11-20-book-009-i-handoff
type: handoff
contract: handoff-file-v1
author: dev
created: 2026-11-20
status: active
item: BOOK-009-I
state: done
brief: inline (BOOK-009 I-009 brief-v1, main thread 2026-11-20)
base: 52267cce
head: (the docs commit that adds this file; walk commit a9194e36, merge ae48f061)
branch: feature/book-009-booking-hours
pushed: true
pr: https://github.com/xavierau/omc/pull/222
stage: poc
suite_changed: false
gate: {result: pass, at: 2026-11-20T15:19Z}
next: {owner: main, action: "review / merge PR #222 into develop (migration 091 before any deploy); then W5 BOOK-010 branches from this head"}
blockers: []
refs: [plans/2026-11-20-book-009-010-plan, specs/2026-11-20-book-009-booking-hours-and-form, artifacts/2026-11-20-book-009-w1-handoff, artifacts/2026-11-20-book-009-w23-handoff, artifacts/2026-11-20-book-009-w4-handoff, tests/evidence/2026-11-20-book-009-i/walk-log]
---
ac:
  AC-1: {result: pass, evidence: "merge commit ae48f061 (parents 52267cce, a07618c3; keeps 42949788); only INDEX.md + handoffs.md conflicted, union-resolved; git diff --cached --check clean; no unmerged paths; git grep '^<<<<<<< ' empty; no code file changed on both sides; resource-lock heavy -- tsc --noEmit → exit 0 (tsc.log); resource-lock heavy -- vitest run → 704 files / 8122 tests passed, exit 0, no flaky reruns needed (vitest-full.log); en/zh-HK message keys 1811/1811"}
  AC-2: {result: pass, evidence: "tests/evidence/2026-11-20-book-009-i/walk-log.md + 01..06 screenshots + pap-probes.log + pap-openapi.log; every step walked-on-local-supabase (supabase start, migrations 001-091, real Postgres/PostgREST/GoTrue, fake tenant); AI agent, PAP confirm-code success, shared 429, en locale marked not-walked"}
  AC-3: {result: pass, evidence: "https://github.com/xavierau/omc/pull/222 (base develop); git ls-remote origin feature/book-009-booking-hours = local HEAD after each push (a9194e36 first push; re-verified after the records commit)"}
decisions:
  - "Local data environment = supabase start (CLI 2.109.1) with realtime/studio/imgproxy/edge-runtime/logflare/vector/mailpit/postgres-meta/supavisor excluded; the Aug segfault (repo memory incident_no_browser_env_for_db_features) did not recur [decide_yourself]"
  - "Local-only GRANT SELECT/INSERT/UPDATE/DELETE on all public tables + sequences to anon/authenticated/service_role: this CLI image's default privileges give the API roles only Dxtm (hosted: arwdDxtm); migrations have no table-level REVOKE so this mirrors prod; never committed [decide_yourself]"
  - "External keys (Kapso, Gemini, FlowForge) overridden with dummies for next dev so no message or model call left the machine [repo public / no real tenant data]"
  - "Times-changed recovery walked for real (Saturday closed in the DB mid-form) because W2/W3 left router.refresh against a real changed config to I-009 [w23 review_focus]"
failed:
  - tried: "first login: /api/me/tenants 500"
    why: "42501 permission denied on user_tenants: local image default privileges (see decisions)"
    evidence: "walk-log.md Environment"
  - tried: "screenshots straight into the tree"
    why: "Chrome DevTools MCP writes only inside the main checkout; wrote to a temp folder there, moved into the tree, removed the folder"
    evidence: "tests/evidence/2026-11-20-book-009-i/*.jpeg"
invariants:
  - "Migration 091 before deploying: staff lists and the agent-booking repository select terms_accepted_at, terms_text"
  - "Hours null → BOOK-001 page, pre-W4 OpenAPI and system instruction (fixtures in the suite)"
unverified:
  - "AI reply agent end to end (BOOKING RULES, refusal suggestions, terms read-back) — no model call locally; tool-level tests only"
  - "Successful PAP booking through the WhatsApp confirm code; promote_agent_booking returning the 091 columns"
  - "Shared 429 on /availability (no Redis; limiters fail open)"
  - "en locale screens, staff badge at 390, DEV/prod Supabase"
review_focus:
  - "Diner page after a times-changed refusal keeps the now-closed date selected (summary bar shows it, 請選擇時段); W3 rule is 'clear the time only' — confirm that is the wanted UX"
  - "First MCP click on the terms checkbox did not tick it, second did; not reproduced, cause unknown"
  - "W1/W23/W4 review_focus items still stand (booking-hours-settings per-path codes, hoursPayload opt-in, parseAgreed terms_changed guard, poppy-documents.ts at 393 lines)"
scope_drift:
  - "next dev regenerated CLAUDE.md (agent block); reverted with git checkout, not committed"
next_step: "Main: review PR #222 (optionally a verifier vision pass on tests/evidence/2026-11-20-book-009-i); merge into develop; W5 BOOK-010 branches from this head. Local Supabase stack was stopped with its volume kept (supabase stop, no --no-backup)."
---

State for a successor: BOOK-009 is integrated on `feature/book-009-booking-hours` and pushed, with PR #222 open into develop (not merged). The local
Supabase stack for this tree (project_id whatsapp-crm, ports 5432x) keeps its volume with the fake walk tenant and the local-only grants.
`supabase start` brings it back, and the grants must be re-applied after any `supabase db reset` (walk-log.md Environment).
