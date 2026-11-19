---
id: artifacts/2026-11-19-book-003-agent-booking-impl
type: artifact
author: dev (book-003-dev)
created: 2026-11-19
status: active
supersedes: null
superseded_by: null
related: [threats/2026-11-19-agent-booking-poppy, plans/2026-11-19-agent-booking-poppy, threats/2026-11-12-restaurant-booking, kanban:BOOK-003]
---

# BOOK-003 implementation: booking through personal agents (PAP 1.0 / poppy.json)

Stage: POC (repo has no mature import). Branch `feature/book-003-agent-booking` from `origin/develop` 7642764cb5.
Evidence folder: `.claude-workspace/artifacts/evidence/2026-11-19-book-003/`.

## What was built

| Piece | Where |
|---|---|
| Migration 084 (renumbered from 083, team-lead ruling 2026-11-19): status `unverified`, source `agent`, decision CHECK `(status IN ('unverified','pending')) = (decided_at IS NULL)`, columns `confirm_code`, `verify_expires_at`, `verified_at`, `verified_wamid`, `status_token_hash`, `idempotency_key`; unique `(restaurant_id, idempotency_key)`, unique code among a restaurant's unverified rows, unique `booking_config->agentBooking->>publicId` | `supabase/migrations/084_agent_booking.sql` |
| `booking_config.agentBooking {enabled:false, publicId, websiteHost}`, settings parse/apply/rotate | `src/domain/value-objects/booking-config.ts` |
| Confirm code VO (6 chars, no 0/O/1/I, at least one digit), body parser (snake_case, identity fields rejected), status view, poppy.json + OpenAPI 3.1 builders, collection statement | `src/domain/services/booking-confirm-code.ts`, `agent-booking.ts`, `poppy-documents.ts` |
| Use cases: create, status read, verify (webhook), settings/rotate/poppy.json, tenant resolve; retention purge of unverified rows | `src/application/booking/*agent*`, `verify-agent-booking.ts`, `purge-booking-pii.ts` |
| Repository + directory | `src/infrastructure/supabase/repositories/agent-booking-repository.ts`; staff lookup now excludes `unverified` (`booking-request-repository.ts`) |
| Public routes (no auth middleware: `src/proxy.ts` matches only `/dashboard` and `/admin`) | `src/app/api/poppy/[publicId]/bookings`, `.../bookings/[id]`, `.../openapi.json` |
| Admin routes | `src/app/api/dashboard/settings/booking/agent` (PUT), `agent/rotate` (POST), `poppy-json` (GET download) |
| Webhook: confirm-code check first for inbound text, before `resolveRoute` (so before receipt YES/NO and BOOK) | `src/app/api/webhooks/whatsapp/booking-confirm-code-handler.ts`, `handlers.ts` |
| UI: "Bookings from AI agents" block under Simple booking (toggle, host, own save, download, rotate); "via AI agent" badge | `src/components/dashboard/booking-agent-settings.tsx`, `booking-settings-section.tsx`, `booking-row.tsx`, `src/hooks/use-booking-settings.ts`, `src/messages/{en,zh-HK}.json` |

## Acceptance evidence

### AC-1 poppy.json passes the PAP kit validator
`evidence/poppy.json` is the file downloaded from the admin route on the local app (tenant "Cafe Poppy", host `www.cafepoppy.hk`).
`node kit/company/validate/index.ts check --file poppy.json` (kit sparse-cloned from github.com/personal-agent-protocol/personal-agent-protocol, Node 22.21): **7 passed, 0 failed, 0 warnings, 7 skipped** (the skipped checks need the network/host), exit 0. Transcript: `evidence/ac1-validator.log`.

### AC-2 openapi.json is valid OpenAPI 3.1
`evidence/openapi.json` fetched from the local app. `npx -y @redocly/cli@1.25.11 lint openapi.json --extends=minimal`: valid, 0 warnings, exit 0 (`evidence/ac2-openapi-lint.log`). With `--extends=recommended`: valid, 1 warning. No dependency added to package.json.

### AC-3 local app, curl
`evidence/ac3-curl.log`: `next dev` on :3093 against a local Supabase stack (CLI, migrations 001..082 + this branch's migration, then numbered 083, applied on start).
- POST valid body (with a garbage `Poppy-Session`) → **202** with `booking_id, status: awaiting_confirmation, confirm_url (wa.me/85230001111?text=確認Cafe Poppy訂座 Confirm my booking at Cafe Poppy: XJ8BWQ), confirm_code, expires_at (+30 min), status_token, collection_statement {en, zh-HK, privacy_url}`; headers `cache-control: no-store`, `referrer-policy: no-referrer`.
- DB row: `status unverified, source agent, member_id null, confirm_code XJ8BWQ, status_token_hash` = sha256 of the returned token; not in the staff list query.
- No WhatsApp send: no send log line during the run (KAPSO key blanked for the run as a guard; the create path has no sender dependency).
- GET with token → 200 `awaiting_confirmation` (status, date, time, party_size, expires_at only); no token → 404; wrong token → 404; body with `restaurant_id` → 400 `unknown_field`.

### AC-4 webhook handler
`src/app/api/webhooks/whatsapp/__tests__/booking-confirm-code.test.ts` (through `routeMessage`), 12/12: code from booking phone → pending + one `received` send + collection statement text, no receipt/unknown routing; lower-cased code works; same code from another phone → unchanged, nothing sent, `handleUnknown` runs; expired code → unchanged + normal routing; other restaurant → unchanged; replayed wamid → one change, one message, the replay runs normal routing; two concurrent deliveries → one message; no code-shaped token → no store call; `REDEEM AB23CD` still redeems; store failure falls through; image never checked.

### AC-5 exclusion and status after confirm
- `src/application/booking/__tests__/agent-booking-lifecycle.test.ts` 3/3: unverified not listed and decide → not_found (no 409 that would reveal it); code → pending, listed with source agent; staff confirm → status read `confirmed`, messages `received`, `confirmed`.
- Real Postgres (`src/infrastructure/supabase/__tests__/agent-booking.db.test.ts`, 9/9 on a scratch DB with 084; 8/9 RED on the same DB built without it): staff list/lookup/decide skip unverified, reminder RPC never returns it, decision once after promotion.
- Local stack: after promotion and the staff Confirm button, `GET .../bookings/{id}` → `{"status":"confirmed",...}` (end of `evidence/ac3-curl.log`). Promotion on the local stack was the repository's UPDATE run as SQL (no Kapso webhook locally).

### AC-6 threat-model tests, R-id → test
| R | Tests (file → test name) |
|---|---|
| R31 | booking-confirm-code.test.ts: "R31/R44: the code from the booking phone → pending…", "R31: the same code from another phone…", "R31: an expired code…", "R31: the code at another restaurant…", "R31: matching is case-insensitive"; agent-booking-domain.test.ts "confirm code (R31)" (4); agent-booking-routes.test.ts "R31: a code clash … draws a new code"; agent-booking.db.test.ts "R31: a code is unique…", "R31: the code from another phone, another restaurant or past expiry promotes nothing" |
| R32 | booking-confirm-code.test.ts "R32: a replayed webhook (same wamid)…", "R32: two concurrent deliveries promote once"; agent-booking-repository.test.ts "R31/R32: promotion is one conditional UPDATE…"; agent-booking.db.test.ts "R32: two concurrent deliveries … promote once; a replay promotes nothing" |
| R33 | agent-booking-routes.test.ts "R33: a restaurant_id (or slug) in the body is an unknown field → 400…"; agent-booking-repository.test.ts "R33: the directory looks up by the JSON path…"; agent-booking.db.test.ts "R33/R43: the agent booking id is unique…" |
| R34 | agent-booking-routes.test.ts "R34: %s → 400 invalid_request with the field, no row" (14 cases), "R34: an international E.164 number is accepted", "R34: a body that is not JSON → 400" |
| R35 | agent-booking-lifecycle.test.ts "R35: after create + verify, source, verified_at, verified_wamid and created_at are set"; agent-booking-repository.test.ts "R35/R42: inserts one row…" |
| R36 | agent-booking-routes.test.ts "AC-3/R36: with the token → awaiting_confirmation and only…", "R36: no token, wrong token, another booking's token, malformed id → 404 with no phone or name", "R36/R43: the right token through another restaurant's or a disabled id → 404"; agent-booking-repository.test.ts "R36: the status lookup and token replacement are scoped…" |
| R37 | agent-booking-routes.test.ts "R37: logs carry no phone, name, notes, code, status token or Poppy-Session on create and error paths"; booking-confirm-code.test.ts "R37: … success and failure paths carry only event names, the wamid and error classes" |
| R38 | agent-booking-routes.test.ts `expectAgentHeaders` on 202, 400, 404, 429 and 200 (AC-3, R34, R43, R39, R36, openapi tests) |
| R39 | agent-booking-routes.test.ts "R39: the 11th POST from one IP…", "R39: a 4th live unverified booking for one phone → 429…", "R39: an expired unverified booking no longer counts…", "R39: the 31st live unverified booking at one restaurant → 429"; agent-booking-repository.test.ts "R39: counts live unverified…" |
| R40 | agent-booking-routes.test.ts "R40: with, without and with a garbage Poppy-Session header the result is identical" |
| R41 | purge-booking-pii.test.ts "deletes unverified rows older than one hour; keeps younger and verified ones"; agent-booking-repository.test.ts "R41: the purge deletes only unverified rows…", "R41: the staff lookup never returns an unverified booking"; agent-booking-lifecycle.test.ts "unverified: not in the staff list, decide → not_found…"; agent-booking.db.test.ts "R31/R41: unverified is invisible…", "R41: the purge…", "AC-5: … reminder RPC" |
| R42 | agent-booking-routes.test.ts "AC-3: 202 with every field, one unverified agent row, nothing sent on WhatsApp (R42)" (store calls = count + insert only; create deps have no sender/member/consent port); agent-booking-repository.test.ts "R35/R42: inserts one row, status unverified, source agent, no member, no token…" |
| R43 | agent-booking-settings.route.test.ts (7: staff → 403 on save/rotate/download; off by default, enable mints id; needs Simple + valid host; rotate → old id stops resolving; off keeps id and 404s; download 409 until enabled; main settings save never touches agentBooking); agent-booking-routes.test.ts "R43: disabled, rotated-away, unknown, malformed id or mode not simple → 404…", "R43: a restaurant without a WhatsApp number…", openapi "R43: 404 when agent booking is off"; agent-booking-domain.test.ts "agent booking config (R43)"; booking-agent-ui.test.tsx |
| R44 | agent-booking-routes.test.ts "R44: the response carries the collection statement…", "R44: OpenAPI 3.1 … collection statement in the description"; booking-confirm-code.test.ts "R31/R44: …"; agent-booking-domain.test.ts "collection statement (R44)" |
| R46 | agent-booking-routes.test.ts "R46: an Idempotency-Key replay returns the same booking and code, one row, a fresh token that replaces the old one", "R46: the same key with a different body → 409…", "R46: the same key at another restaurant is a separate booking", "R46: a replay after the diner confirmed returns the current status…"; agent-booking.db.test.ts "R46: one row per idempotency key per restaurant" |

Gates (this tree, base 7642764cb5 + this branch): touched-file runs green; full suite once under the heavy lock: **626 files passed, 11 skipped; 6,935 tests passed, 75 skipped** (`npx vitest run`); `npx tsc --noEmit` exit 0; `npx eslint` on every changed/added file: 0 problems. Whole-repo `eslint .` reports 169 problems, none in files this branch touches (pre-existing).

### AC-7 settings page + badge (screenshots)
- `evidence/ac7-settings-agent-on-1280.png`: admin `/dashboard/setup`, Simple booking, "Bookings from AI agents" with Allow AI agents ticked, host `www.cafepoppy.hk`, saved, Download poppy.json + Change agent booking address. Before the host was filled, Save showed "Add your website address." (checked in the page).
- The file the download route served is `evidence/poppy.json`, the same bytes AC-1 validated.
- `evidence/ac7-bookings-via-agent-1280.png`: `/dashboard/bookings` with the agent row's "via AI agent" badge and a chat row without it; after Confirm the row read "Confirmed · via AI agent · Message not delivered" (WhatsApp blanked locally).
- Seeded locally (the DEV DB lacks 082 and this migration): local Supabase CLI stack, restaurant + admin user + `user_tenants` row, table grants for `authenticated`/`service_role` (the local image did not grant them; hosted Supabase does), `x-tenant-id` cookie set by hand (`/api/me/tenants` 500'd before the grants). Seed: scratchpad `seed-local.sql` (not committed).

## Migration validation
- **Renumbered 083 → 084** (team-lead ruling 2026-11-19: AGENT-001's PR #185 claimed 083 with `083_agent_reply.sql`). The SQL is unchanged; only the file name and the comments/test names that cite it changed.
- Re-validated after the rename: scratch DB `scratch_book003` on local Postgres 17 (127.0.0.1:5432) built from develop's 001..082 only (not agent-001's 083) with Supabase stubs (roles, auth/storage stubs, pgcrypto in `extensions`, search_path public,extensions, publication): all applied; 084 applied cleanly. `agent-booking.db.test.ts` + BOOK-001's `booking.db.test.ts` + `booking-cron.db.test.ts`: 24/24 with 084; `agent-booking.db.test.ts` 8/9 red without it. DB dropped afterwards.
- Before the rename: the same checks ran with the file named 083, and `supabase start` (CLI 2.109.1, realtime/storage excluded) applied 001..082 + this migration on the Supabase Postgres image (the AC-3/AC-7 local stack).

## Decisions (decide_yourself)
- API field names are snake_case (`party_size`, `booking_id`), matching the response contract in the brief.
- Confirm text: `確認{restaurant}訂座 Confirm my booking at {restaurant}: {CODE}`; code must contain a digit so ordinary words never trigger the lookup; matching case-insensitive; at most 3 candidates per message.
- Replay of a booking no longer awaiting confirmation answers 200 with the status view + fresh `status_token` (no code); an Idempotency-Key older than 24 h answers 409 (the unique index keeps the key on verified rows).
- Caps answer 429 with `Retry-After: 600`; the per-IP limit answers `Retry-After: 60`. The limiter fails open, as BOOK-001.
- Agent bookings keep `member_id` null (even after verification); the sender looks up language by phone.
- Restaurant without a WhatsApp number → 404 (the diner could not confirm).
- Collection statement names "phone number" in addition to BOOK-001 R18's fields, because this API collects the phone.
- OpenAPI declares `security: []` (signed out).

## Not as briefed / notes
- `files_allowed` lists `messages/**` and `src/middleware.ts`; the repo's messages live at `src/messages/*.json` (edited) and its middleware is `src/proxy.ts` (not edited: its matcher already excludes `/api/poppy`).
- Migration renumbered to 084 per the team-lead ruling (agent-001 PR #185 owns 083); this replaces "migration 083" in the brief.
- R45 (privacy policy names AI agents) is an owner go-live item; not in this code.
- `next dev` (Next 16.3.4) rewrites `CLAUDE.md` with an agent-rules block; reverted, not committed.
