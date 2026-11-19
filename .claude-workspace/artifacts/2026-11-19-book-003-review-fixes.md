---
id: artifacts/2026-11-19-book-003-review-fixes
type: artifact
author: dev (BOOK-003 r2)
created: 2026-11-19
status: active
supersedes: null
superseded_by: null
related: [artifacts/2026-11-19-book-003-agent-booking-impl, threats/2026-11-19-agent-booking-poppy, threats/2026-11-12-restaurant-booking, kanban:BOOK-003]
---

# BOOK-003 r2: code-review fixes on PR #186 and migration 084

Stage: POC. Tree `whatsapp-crm--book-003`, branch `feature/book-003-agent-booking`, base 84ea383ec8.
Evidence folder: `.claude-workspace/artifacts/evidence/2026-11-19-book-003-r2/`.
Threat model: the main checkout's copy of `threats/2026-11-19-agent-booking-poppy` (R41 revised 2026-11-19) copied over the tree's copy and committed.

## Per finding (AC-1)

| # | Red test (file › name) | Red → green | Fix |
|---|---|---|---|
| F1 create | `agent-booking-routes.test.ts` › "F1 (BOOK-001 R11): pending + live unverified for the phone at this restaurant >= 3 → 429, no insert", "… three pending at this restaurant → 429 even with no unverified booking" | `f1-f2-red.log` (2 ×) → `f1-f2-green.log` | `create-agent-booking.ts` overCap: live unverified + `countPending` (new port method, any source, this restaurant) ≥ `MAX_PENDING_PER_PHONE` → 429 `Retry-After 600`. Per-phone unverified and per-restaurant caps unchanged. |
| F1 promote | `booking-confirm-code.test.ts` › "F1 (BOOK-001 R11): three pending at this restaurant → the code promotes nothing…", "F1: two codes in one text with room for one more pending → one promotion…", "F1: pending at another restaurant does not block the code here" | `f1-f2-red.log` (2 ×; the third passed on old code, as it should) → `f1-f2-green.log` | Promotion is now RPC `promote_agent_booking(restaurant, phone, codes, wamid, at, max_pending)` in 084 §4: `pg_advisory_xact_lock` on (restaurant, phone), count pending, UPDATE at most `max_pending − pending` rows (oldest first) with the status re-check. Over the cap → no row → `handled: false`, nothing sent, normal routing. Service role only (REVOKE PUBLIC/anon/authenticated). |
| F1 real Postgres | `agent-booking.db.test.ts` › "F1 (BOOK-001 R11): a phone with three pending here cannot promote; another restaurant's pending do not count", "F1: room for one more pending → a text with two codes promotes only the oldest", "F1: two concurrent promotions for one phone with room for one → exactly one wins (advisory lock)", "F1: promote_agent_booking is service-role only" | `f1-db-red-old084.log` (old 084: 8/13 red, function absent) → `f1-db-green.log` (28/28 with BOOK-001 db tests) | Lock is load-bearing: the same 084 with the advisory lock swapped for `pg_sleep(0.2)` fails the concurrency test (2 winners), `f1-db-red-nolock.log`. |
| F2 | `booking-confirm-code.test.ts` › "F2: agent booking turned off / booking mode external / booking mode off → the code promotes nothing, nothing sent, normal routing" | `f1-f2-red.log` (3 ×) → `f1-f2-green.log` | `verify-agent-booking.ts` reads `settings.getConfig(restaurant)` after the code-shape pre-check; promotes only while `agentBooking.enabled && mode === 'simple'`, else `handled: false` with no `promote` call. |
| F3 | `booking-reminders/__tests__/route.test.ts` › "F3 (R41): the unverified purge still runs when the reminder step throws; 500 without internals", "F3: a failing purge does not stop the reminders…"; `purge-booking-pii.test.ts` › "purgeUnverifiedBookings (R41) › deletes unverified rows older than one hour…" | `f3-red.log` (module missing) → `f3-green.log` | New use case `purge-unverified-bookings.ts`; the 5-minute `booking-reminders` route runs reminders and the purge as two independent steps (each in its own try; a failure → 500 naming the step, logged by error name). Removed from `purgeBookingPii` / `booking-retention` (returns `{purged, cutoffDate}` again). No Forge schedule or `scripts/cron/*.sh` change. |
| F4 | `booking-agent-ui.test.tsx` › "F4: the section holds the agent state even while the block is hidden (External, Off)" (+ "F4: the block shows the state it is handed, not the page-load config") | `f4-red.log` (1 ×) → `f4-green.log` | Confirmed real by reading: the block unmounted outside Simple and reseeded from static `initialConfig.agentBooking`. Fix: `useAgentBookingSettings` moved up into `BookingSettingsSection` (never unmounts on a mode change); `BookingAgentSettings` takes `agent` state as a prop. The repo's vitest has no DOM (node env, no jsdom/testing-library; adding one is a dependency), so the click-through Simple→External→Simple cannot run as a test; the tests pin the ownership that makes it work. |
| F5 | `agent-booking-domain.test.ts` › "F5: a restaurant name full of code-like words never pushes the real code out of the candidates" | `f5-red.log` → `f5-green.log` | `extractConfirmCodeCandidates` keeps the LAST 3 distinct candidates (the prefilled text ends with the code). Note: the brief's name `K11 MUSEA 2NDFLR B2CAFE` has only 2 code-shaped tokens, so with the code it is exactly 3 and did not fail; the test adds `3RDFLR` to overflow (red: `['2NDFLR','B2CAFE','3RDFLR']`). |
| F6 | `agent-app-url.test.ts` › "resolveAgentAppUrl (F6)" (11 cases); `agent-booking-settings.route.test.ts` › "F6: without a usable NEXT_PUBLIC_APP_URL the download is 500 server_error, logged by error name only"; `agent-booking-routes.test.ts` › "F6: without a usable NEXT_PUBLIC_APP_URL → 500 server_error…" | `f6-f7-red.log` → `f6-f7-green.log` | `resolveAgentAppUrl(raw, NODE_ENV)`: https origin only; http only for localhost/127.0.0.1/[::1] outside production; empty/relative/credentials → null. `booking-deps` passes `appUrl: string \| null`; `agentApiBaseUrl` throws `AgentAppUrlError`; poppy-json → 500 `{error:'server_error'}`, openapi.json → 500 `server_error`; both log `'AgentAppUrlError'` only. |
| F7 | `agent-booking-settings.route.test.ts` › "F7: download answers 409 not_enabled once booking mode is not Simple, even with agent booking on" | `f6-f7-red.log` → `f6-f7-green.log` | `generatePoppyJson` returns `not_enabled` when `mode !== 'simple'`. |
| F8 | `src/hooks/__tests__/download-poppy-json.test.ts` › "appends the link to the body, clicks it while attached, removes it, then revokes the URL on a later tick" | `f8-red.log` (`['click:false','revoke']`) → `f8-green.log` | `downloadPoppyJson` (now exported): `document.body.appendChild`, `click`, `remove`, `setTimeout(revokeObjectURL, 0)`. |
| F9 | `agent-booking-domain.test.ts` › "website host… › www.x.hk:0443 → www.x.hk", "https://www.x.hk:00443/ → www.x.hk", "cafe.hk:08443 → cafe.hk:8443" (+ rejects `:00000`, `:65536`) | `f9-red.log` (`'www.x.hk:'`) → `f9-green.log` | `normalizeWebsiteHost` rebuilds `host[:port]` from the parsed host and `Number(port)`. |
| F10 | `agent-booking-domain.test.ts` › "OpenAPI description (review F10) › documents the Idempotency-Key replay…", "documents 500 server_error on both operations" | `f10-red.log` → `f10-green.log` | `createBooking` 200 → `ReplayedBooking` (`allOf` BookingStatus + `status_token` + `collection_statement`); 500 `Error` on both operations. The description's cap sentence now states BOOK-001 R11 (3 open requests: unconfirmed or waiting for the restaurant), since F1 changed the cap. Lint below. |

## AC-2 migration 084
- `git ls-files supabase/migrations | grep 08[34]_` → only `084_agent_booking.sql` (`f11-scratch-build.log`). The rename itself was commit 665419a3 (r1 follow-up); r2 added §4 (the promote RPC) to the same file. No other 083 reference left in `src/`, `supabase/`, `tests/` (the plan artifact keeps its historical "083" lines; main-thread planning doc, not edited).
- Scratch DB `scratch_book003` (local Postgres 17, Supabase stubs): develop's 001..082 (the tree's copies, `git diff origin/develop` on them empty) then 084 → 83 files applied. `agent-booking.db.test.ts` 13/13 + `booking.db.test.ts` + `booking-cron.db.test.ts` = 28/28 (`f1-db-green.log`). DB dropped.

## AC-3 gates
- Touched-file runs green per finding (logs above).
- Full vitest once under the heavy lock: 628 files passed / 11 skipped, 6971 tests passed / 79 skipped (`ac3-gates.log`).
- `tsc --noEmit` exit 0 (heavy lock). ESLint on the 31 changed .ts/.tsx files: exit 0.
- OpenAPI: `npx -y @redocly/cli@1.25.11 lint openapi.json --extends=minimal` → valid, exit 0 (`ac3-openapi-lint.log`).
- PAP kit validator `check --file poppy.json`: 7 passed, 0 failed, 7 skipped, exit 0 (`ac3-pap-validator.log`).
- Both documents were generated by the tree's own use cases (`generatePoppyJson`, `agentOpenApiFor` with `resolveAgentAppUrl('https://app.ohmyclient.io','production')`) through a scratchpad tsx script, not fetched from a running app (`poppy.json`, `openapi.json` in the evidence folder).

## Decisions (decide_yourself)
- **Promote shape:** a plpgsql RPC with a transaction-scoped advisory lock keyed on (restaurant, phone), the pending count and a LIMITed conditional UPDATE in one call; grants match `booking_reminder_candidates` (082). An advisory lock rather than `FOR UPDATE`, because the rows that decide the cap (pending ones) may not be the rows being changed.
- **Agent settings state (F4):** lifted into `BookingSettingsSection` instead of hiding the block, so Off/External still render no agent markup (existing test kept).

## Not as briefed / notes
- F1 race-safety covers concurrent promotions. A BOOK-001 chat/campaign submission racing a promotion for the same phone is not under the lock: BOOK-001's own submit is count-then-insert and was not race-safe before this change either. Not changed (outside the finding).
- F5: the brief's sample name does not reproduce the bug alone (see table); the test uses it plus one more code-like word.
- F6: the dashboard poppy-json route's other 500s keep their existing body; only the misconfigured-URL case answers `{error:'server_error'}`.
