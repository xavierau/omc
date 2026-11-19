---
id: plans/2026-11-19-agent-booking-poppy
type: plan
author: main
created: 2026-11-19
status: draft (awaiting owner approval)
supersedes: null
superseded_by: null
related: [threats/2026-11-19-agent-booking-poppy, specs/2026-11-12-restaurant-booking, kanban:BOOK-003]
---

# Plan: Booking through personal agents (PAP 1.0 / poppy.json) — BOOK-003

Stage: POC (repo has no mature import). Base: `origin/develop` (local `main` is behind).

## Objective
Learn-question: given only a restaurant's website address, can a personal agent find our booking
API through `poppy.json`, submit a booking, and get the diner to confirm it on WhatsApp so it lands
in the staff queue? Evidence: a real run against a test tenant, with Claude as the agent.

Owner decisions 2026-11-19: **1B** poppy.json on the restaurant's own domain (spec §3 forbids a
redirect to our host, so the restaurant hosts a file we generate; the API URL inside it points to
us). **2B** the diner proves the phone by sending a code on WhatsApp before staff see it.

## Context (files, constraints, dependencies)
- Reuse: `src/application/booking/submit-booking-request.ts` (validation via
  `parseBookingSubmission`, pending cap, insert, `notifyReceived`), `booking-deps.ts`,
  `resolve-booking-link.ts` (`buildContactUrl` + `restaurant.whatsappNumber` for the wa.me link),
  `src/app/api/b/[token]/route.ts` (response/headers pattern), `booking-security-headers.ts`,
  webhook `src/app/api/webhooks/whatsapp/handlers.ts` (`dispatchConfirmation` order),
  `book-handler.ts`, booking-retention cron, `booking-settings-section.tsx` + settings route.
- Schema: `082_booking.sql` — `booking_requests.status IN (pending, confirmed, declined)`,
  `source IN (chat, campaign)`, constraint `(status='pending') = (decided_at IS NULL)` must become
  `(status IN ('unverified','pending')) = (decided_at IS NULL)`. Next migration: `083_`.
- PAP sources: spec §3, §5.3, §7; kit `patterns/poppy-json.md`, `patterns/openapi.md`; validator
  `kit/company/validate` (`node <kit>/validate/index.ts check --file poppy.json`).

## Domain Model (entities, VOs, aggregates)
- `BookingRequest` gains status `unverified`, source `agent`, `confirmCode`, `verifyExpiresAt`,
  `verifiedAt`, `verifiedWamid`, `statusTokenHash`, `idempotencyKey`.
- `BookingConfig` gains `agentBooking: { enabled: boolean; publicId: string }` (publicId random,
  rotatable).
- VO `ConfirmCode` (6 chars, alphabet without 0/O/1/I; parse from inbound text).

## Subtasks (one `dev` work item, branch `feature/book-003-agent-booking`)
1. Migration 083 + entity/VO changes + repository (R31, R35, R41, R46).
2. Use case `createAgentBooking` (R33, R34, R39, R40, R42, R44, R46) and `getAgentBookingStatus` (R36).
3. Routes: `POST /api/poppy/{publicId}/bookings`, `GET /api/poppy/{publicId}/bookings/{id}`,
   `GET /api/poppy/{publicId}/openapi.json` (OpenAPI 3.1; description carries the flow and the
   collection statement), `GET /api/poppy/{publicId}/poppy.json` (the file the restaurant
   downloads: `organization.domain` = the restaurant's host from settings, `apis[0]` openapi → our
   URL) (R36–R38, R43, R44).
4. Webhook: confirm-code check first in `dispatchConfirmation` for text messages; promote +
   "received" reply with collection statement; mismatch falls through unchanged (R31, R32, R44).
5. Exclusions: staff list, decision routes, reminders skip `unverified`; retention deletes expired
   unverified rows (R41).
6. Settings (admin only): toggle, website host field, rotate id, download poppy.json (R43).
7. I-task: wiring end-to-end + evidence (below).

## Integration Map
- Routes under `src/app/api/poppy/[publicId]/…` (public; confirm no auth middleware matcher blocks them).
- Webhook dispatch order in `handlers.ts` (before receipt YES/NO handling).
- `booking_config` JSON schema/zod + settings route + `booking-settings-section.tsx` + i18n keys (en, zh-HK).
- Booking list query + `booking-list.tsx` "via AI agent" badge (source `agent`).
- Retention cron selection.

## Acceptance Criteria
- AC1 `poppy.json` generated for the test tenant passes the PAP kit validator.
- AC2 `openapi.json` is valid OpenAPI 3.1.
- AC3 POST with valid body → 202 `{booking_id, status:"awaiting_confirmation", confirm_url (wa.me to
  the restaurant with the code), expires_at, status_token, collection_statement}`; nothing sent on WhatsApp.
- AC4 Sending the code from that phone → booking `pending`, "received" reply, visible in the staff
  queue with the agent badge; from another phone → nothing changes.
- AC5 Staff confirm → diner gets the confirmed template; GET status shows `confirmed`.
- AC6 Every R31–R44, R46 test from the threat model passes.
- AC7 Reachable end to end: settings toggle → downloaded poppy.json → API → WhatsApp → dashboard.
- Evidence (POC): local curl transcript for AC1–AC3/AC6; AC4–AC5 on the real stack after release
  with a test tenant and a test domain serving poppy.json, Claude acting as the agent.

## Performance Budgets
POST and GET ≤ 300 ms p95 server time (two indexed queries + one insert); webhook code check adds
≤ 1 indexed query to text messages that match the code pattern only.

## Out of Scope
Session JWT verification; OAuth sign-in; Operations approval extension; conversation (`agent`)
endpoint; MCP; a server-side domain checker (SSRF review needed); availability/slots; cancel or
change a booking through the agent.

## Risks & Open Questions
- No known agents consume poppy.json yet (learn-question).
- Restaurants on Wix/Instagram may not be able to serve `/.well-known/`.
- Test domain for evidence: default a subdomain on activedevelopment.cloud (Cloudflare Pages);
  release to prod and the DNS record need owner OK at that point.
- Privacy policy copy (R45) owned by Xavier before go-live.
