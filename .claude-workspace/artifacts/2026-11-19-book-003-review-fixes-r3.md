---
id: artifacts/2026-11-19-book-003-review-fixes-r3
type: artifact
author: dev (BOOK-003 r3)
created: 2026-11-19
status: active
supersedes: null
superseded_by: null
related: [artifacts/2026-11-19-book-003-review-fixes, threats/2026-11-19-agent-booking-poppy, kanban:BOOK-003]
---

# BOOK-003 r3: /review fixes G1–G3 on PR #186

Stage: POC. Tree `whatsapp-crm--book-003`, branch `feature/book-003-agent-booking`, base 0d95fd0 (checked at start).
Evidence folder: `.claude-workspace/artifacts/evidence/2026-11-19-book-003-r3/`.
Threat model: the main checkout's `threats/2026-11-19-agent-booking-poppy` (R39 revised 2026-11-19) copied over the tree's copy and committed.

## Per finding (AC-1)

| # | Red test (file › name) | Red → green | Fix |
|---|---|---|---|
| G1 | `agent-booking-routes.test.ts` › "G1 (R39 rev): the 6th create from one IP at one restaurant within 30 min → 429; a second IP there still books" (also: same IP at another restaurant still books; Retry-After 1800), "G1 (R39 rev): the per-IP window frees after 30 minutes; replays and invalid bodies do not use it up", "G1 (R39 rev): 30 live unverified no longer close a restaurant; the safety cap is 500"; guard (passes on old code too): "G1 (R39 rev): the per-IP-per-restaurant limiter fails open; the client IP is never written to the row" | `g1-red.log` (3 ×) → `g1-green.log` (44/44) | `create-agent-booking.ts`: new step 6, `incrWindow('book003:agent-restaurant:{restaurantId}:{ip}', 5, 1800)`, after the replay check and the phone/restaurant caps, right before the insert, so only requests about to insert count. Fails open like the 10/min limiter (shared `withinWindow` helper, logs the error name). 429 `Retry-After 1800` (fixed window, worst case). `MAX_UNVERIFIED_PER_RESTAURANT` 30 → 500. 10/min per IP and 3 per phone (with pending, F1) unchanged. The old "31st at one restaurant" test is replaced by the 500 test. The fake store gains `seedUnverified` (test setup). |
| G2 | `agent-booking-settings.route.test.ts` › "G2: without a usable WhatsApp number the download is 409 no_whatsapp_number…" (null, '', unparseable, no restaurant row); `download-poppy-json.test.ts` › "G2: a restaurant without a WhatsApp number gets its own reason and no link"; `booking-agent-ui.test.tsx` › "G2: a download refused for no WhatsApp number shows its own message, not the generic failure" | `g2-red.log` (5 ×, incl. the two existing download tests whose return type changed) → `g2-green.log` (64/64 with the routes file) | New domain predicate `hasConfirmableWhatsAppNumber` (`domain/services/agent-booking.ts`), the exact contextFor condition; `contextFor` now uses it. `generatePoppyJson` returns `{ok:false, reason:'no_whatsapp_number'}` after the not_enabled check; the route answers 409 with that reason. `downloadPoppyJson` returns `'downloaded' | 'no_whatsapp_number' | 'failed'` (was boolean); the hook maps it to a new outcome kind shown by the error line (`booking-agent-error`) with `bookingSettings.agent.noWhatsappNumber` in en and zh-HK. |
| G3 | `booking-confirm-code.test.ts` › "G3: the received message fails after promotion → still handled (no fallback), the other promoted row still acknowledged, error name only", "G3: the restaurant lookup failing after promotion → still handled, no fallback routing" | `g3-red.log` (2 ×) → `g3-green.log` (23/23 with the lifecycle test) | Confirmed real: `acknowledge` was unwrapped, so a send/lookup throw escaped `verifyAgentBooking`, the handler's catch returned false and the diner got the fallback menu; later promoted rows got nothing. Fix: each `acknowledge` in its own try/catch, `console.error` with error name + booking id only; `handled` stays `promoted.length > 0`. |

## AC-2 gates
- Touched-file runs green per finding (logs above); `src/domain` 1386/1386.
- Full vitest once under the heavy lock: 628 files passed / 11 skipped, 6979 passed / 79 skipped / 2 todo, exit 0 (`ac2-full-vitest.log`; r2 was 6971: −1 replaced, +9 new).
- `tsc --noEmit` exit 0 under the heavy lock (`ac2-tsc.log`).
- ESLint on the 14 changed .ts/.tsx files: exit 0, 0 problems (`ac2-eslint.log`).
- OpenAPI: the document did not change (`poppy-documents.ts` untouched), so no re-lint.

## Decisions (decide_yourself)
- **Key and window:** `book003:agent-restaurant:{restaurantId}:{ip}`, a separate prefix from the 10/min `book003:agent:{ip}` key; fixed 30-minute `incrWindow`, as the other limiter uses. Counted just before the insert, so replays, invalid bodies and requests already refused by a cap don't use up an IP's 5.

## Not as briefed / notes
- G2: the poppy.json download check also refuses when the restaurant row is missing (same as contextFor, which 404s then).
- The OpenAPI description still lists only the per-phone limit; the new per-IP limit is not described to agents (429 + Retry-After covers it). Not changed.
