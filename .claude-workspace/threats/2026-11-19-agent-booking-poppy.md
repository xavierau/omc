---
id: threats/2026-11-19-agent-booking-poppy
type: threat-model
author: claude (main thread)
created: 2026-11-19
status: active
supersedes: null
superseded_by: null
related: [plans/2026-11-19-agent-booking-poppy, threats/2026-11-12-restaurant-booking, kanban:BOOK-003]
---

# Threat Model: Booking through personal agents (Personal Agent Protocol 1.0) — BOOK-003

Scope: a signed-out, public booking API for personal agents (PAP 1.0, "Poppy"), listed in a
`poppy.json` the restaurant serves on its own domain (owner decision 1B, 2026-11-19). The diner
proves the phone number by sending a code from WhatsApp before staff see the booking (owner
decision 2B, 2026-11-19). It extends BOOK-001; its R1–R22 still hold and are not repeated.

Spec sources (read 2026-11-19 from github.com/personal-agent-protocol/personal-agent-protocol,
1.0 published 2026-11-14): spec §3 (discovery), §5.3 (Session verification), §7 (APIs);
kit/company/patterns/poppy-json.md, openapi.md.

## Assets
- Diner PII submitted by an agent: name, phone (E.164), party size, date/time, notes.
- The restaurant's WhatsApp number, its quality rating and its message spend.
- The staff booking queue (integrity: only real, phone-verified requests reach it).
- The per-restaurant agent booking id (public, but it routes writes to one tenant).
- The status token returned to the agent (read access to one booking's status).

## Trust Boundaries
1. Personal agent (untrusted, unauthenticated) → `POST /api/poppy/{agentBookingId}/bookings`
   and `GET .../bookings/{id}`. We do not verify the `Poppy-Session` JWT, and we rely on no
   Session claims (allowed by spec §5.3 / §7). Every field in the request is untrusted.
2. Diner's WhatsApp → Kapso webhook → the confirm-code handler (sender phone is trusted as
   today: it comes from the signed Kapso webhook).
3. Restaurant website → `/.well-known/poppy.json`: outside our control. We generate the file,
   the restaurant hosts it. We never fetch it from our servers in this slice (no SSRF surface).
4. Staff dashboard (authenticated tenant user) → booking list and confirm/decline (BOOK-001 R4–R6).

## STRIDE
- **Spoofing.** Anyone can submit any phone number. The booking stays `unverified`, invisible
  to staff and never messaged, until a WhatsApp message carrying its code arrives from that
  exact number (R31, R32). An attacker can verify only bookings for a number they control.
  Agent identity is not verified and is not relied on (R40).
- **Tampering.** Restaurant id comes only from the agent booking id in the path, never from the
  body (R33). Body is strictly validated, unknown fields rejected (BOOK-001 R3 reused, R34).
  Status changes are conditional UPDATEs (R32, BOOK-001 R4).
- **Repudiation.** Each agent booking stores source `agent`, created_at, verified_at and the
  verifying wamid (R35). The client IP is not stored.
- **Information disclosure.** The status endpoint needs the 256-bit status token and returns
  status, date, time, party size only, never the phone or name (R36). No PII, codes, status
  tokens or Session JWTs in logs (R37). Responses `Cache-Control: no-store` (R38).
- **Denial of service.** Flooding unverified rows: per-IP rate limit, live-unverified caps per
  phone and per restaurant, 30-minute expiry, deletion of expired rows (R39, R41). Flooding the
  queue is impossible without controlling many WhatsApp numbers.
- **Elevation of privilege.** The API writes only `booking_requests` rows in status
  `unverified`; it never creates members, consent rows, coupons or messages (R42). A disabled
  or rotated agent booking id answers 404 (R43).

## OWASP Top 10 Coverage (applicable categories only)
- A01 Broken Access Control: R33 (tenant from path id only), R36 (status token), BOOK-001 R6.
- A03 Injection: zod validation (R34); notes/name rendered as text (BOOK-001 R3); template
  params sanitised (BOOK-001 R16).
- A04 Insecure Design: phone ownership proven over WhatsApp (R31–R32), no trust in agent claims (R40).
- A05 Security Misconfiguration: headers (R38); feature off by default per tenant (R43).
- A07 Identification and Authentication Failures: confirm code bound to sender phone (R31).
- A09 Logging and Monitoring Failures: R35, R37.
- A10 SSRF: not applicable in this slice (we never fetch the restaurant's domain; a domain
  checker is out of scope and needs its own threat review).

## Secrets & PII
PDPO (Cap. 486):
- DPP1 collection purpose: the diner sees a collection statement in the WhatsApp reply when
  they confirm (who receives it, purpose, privacy link), and the agent gets the same text in
  the POST response and the OpenAPI description (R44). Data collected is the BOOK-001 set only.
- DPP2 retention: unverified rows are deleted 30 minutes after expiry by the retention job
  (R41); verified rows follow BOOK-001 R19 (name/notes cleared 180 days after the booking date).
- DPP3 use: booking handling only; no member enrolment, no marketing consent (R42, BOOK-001 R21).
- DPP4 security: R31–R39.
- DPP5 openness: privacy policy already carries the booking line (BOOK-001 go-live item).
  Gap: it does not mention bookings made through AI agents. R45.
- DPP6 access/correction: unchanged from BOOK-001 (restaurant handles via staff).
- Direct marketing (Part 6A): not applicable; booking messages are utility only (BOOK-001 R21).
- Cross-border: no new transfer (no classifier call on this path).
Secrets: none new. Status tokens and confirm codes are stored hashed or random-only, never logged.

## Auth & Authz
- Agent API: signed out by design (spec §7 allows it). Authorisation = (a) the per-restaurant
  agent booking id selects the tenant, (b) the status token reads one booking, (c) the diner's
  WhatsApp message promotes the booking. No OAuth server, no Session verification.
- Settings (enable agent booking, rotate the agent booking id, generate poppy.json): tenant
  admin only, same as BOOK-001 R14 (R43).

## Supply Chain (new deps + scanner / native-audit result)
No new dependency planned (zod, crypto, existing rate limiter). Any new package the dev adds
needs the supply-chain-guard scan before merge; none expected.

## Required Mitigations
| ID | Mitigation | Test that proves it | Phase |
|---|---|---|---|
| R31 | Confirm code: 6 chars from an unambiguous alphabet (no 0/O/1/I), random, unique among live unverified bookings of that restaurant. A WhatsApp message promotes a booking only if the code matches AND the sender phone equals the booking phone AND status is `unverified` AND it is not expired. Any mismatch falls through to today's routing unchanged and reveals nothing. | Handler tests: right code + right phone → promoted; right code + other phone → not promoted, normal routing runs; expired → not promoted; already pending → not promoted again. | Build |
| R32 | Promotion is one conditional UPDATE `status='unverified' → 'pending'` with `verified_at` and the wamid; the "received" message is sent only if a row changed. A replayed webhook (same wamid) promotes nothing. | Test: two deliveries of the same message → one status change, one message. | Build |
| R33 | Restaurant id is resolved only from the agent booking id in the path (looked up in booking_config); a body field naming a restaurant, phone override or slug is rejected as an unknown field. | Route test: body with `restaurant_id` → 400; booking lands on the path's restaurant only. | Build |
| R34 | Body validated with the BOOK-001 rules (`parseBookingSubmission`: date ≥ today HK, HH:MM, party 1–max, name ≤ 60, notes ≤ 500) plus phone as E.164 (HK or international); unknown fields rejected. | Route tests per field; unknown field → 400 `invalid_request`. | Build |
| R35 | Agent bookings store `source='agent'`, `verified_at`, `verified_wamid`, `created_at`. | Repository test: after create + verify, columns set. | Build |
| R36 | `POST` returns a status token (`randomBytes(32)` base64url; only its SHA-256 is stored). `GET .../bookings/{id}` requires it in the header `X-Booking-Status-Token` (never in the URL; `Authorization` stays free for PAP access tokens) and returns only `status`, `date`, `time`, `party_size`, `expires_at` (while unverified). Wrong/missing token → 404, same as unknown id. | Route tests: no token / wrong token / other booking's token → 404; response body has no phone or name keys. | Build |
| R37 | No phone, name, notes, confirm code, status token or `Poppy-Session` value in logs; errors log the error class and booking id only. | Test with captured logger on create, verify and error paths. | Build |
| R38 | All agent API responses send `Cache-Control: no-store` and `Referrer-Policy: no-referrer`; JSON only. | Route test asserts headers on 2xx and 4xx. | Build |
| R39 | Rate limits: POST per client IP 10/min (existing limiter, `extractTrustedClientIp`); at most 3 live unverified bookings per phone per restaurant and 30 live unverified per restaurant → 429 with `Retry-After`. | Tests for each cap. | Build |
| R40 | The `Poppy-Session` header is accepted and ignored; no behaviour depends on it or on any agent-supplied identity. | Test: same request with/without/garbage `Poppy-Session` → identical result. | Build |
| R41 | Unverified bookings expire 30 min after creation; the existing booking-retention job deletes unverified rows older than 1 hour. Staff list, reminders and decision routes exclude `unverified`. | Purge test on fixtures; list/reminder/confirm tests with an unverified row → excluded / 404. | Build |
| R42 | The agent API writes only one `booking_requests` row (status `unverified`) and nothing else: no member, consent, message, coupon. | Test: create → no other repository writes, no sender call. | Build |
| R43 | Agent booking is off by default per restaurant; enabling it, rotating the agent booking id (old id → 404 at once) and downloading poppy.json require tenant admin; it works only when booking mode is `simple`. | Settings route tests (non-admin → 403); API with disabled/rotated id or mode ≠ simple → 404. | Build |
| R44 | Collection statement (zh-HK and en, same text as BOOK-001 R18) is in the POST response, the OpenAPI description, and the WhatsApp "received" reply after verification. | Response and reply-builder tests assert the statement and privacy link. | Build |
| R45 | Privacy policy names bookings made by AI agents on the diner's behalf. | Owner checklist item before go-live (copy owned by Xavier). | Release |
| R46 | `Idempotency-Key` on POST: same key + same restaurant within 24 h returns the original booking id and status plus a fresh status token that replaces the old one (no second row, no second code). Different body with the same key → 409. | Tests: replay → same booking id, one row; changed body → 409. | Build |

## Open Risks & Acceptance (risks not mitigated, who owns acceptance)
- **Nobody may use it.** No list of agents that consume poppy.json exists today. Owner: Xavier
  (POC learn-question).
- **Restaurant can't host a file at `/.well-known/`** (Wix/Instagram-only sites). Then no agent
  booking for that restaurant in this slice. Owner: Xavier (product).
- **Garbage that stays invisible.** Up to 30 unverified rows per restaurant at a time can be
  junk; they never reach staff and are deleted within ~1 h. Accepted, owner Xavier.
- **Staff cannot see agent bookings that the diner never confirmed.** By design (2B). Accepted.
- **Agent identity unverified.** We cannot block a misbehaving agent by client_id, only by IP
  and caps. Verify Session JWTs in a later slice if abuse shows up. Owner Xavier.

## Verdict: CONDITIONAL
## Required Changes (if BLOCKED/CONDITIONAL)
The plan must map R31–R44 and R46 to build tasks with the tests above, and R45 to the release
checklist.
