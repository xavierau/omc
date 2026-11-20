---
id: artifacts/2026-08-27-camp-008-stream-a-webhooks-v2-backend
type: artifact
author: senior-backend-dev
created: 2026-08-27
status: active
supersedes: null
superseded_by: null
related: [kanban:CAMP-008, github:131]
---

# CAMP-008 Stream A — Kapso v2 outbound status classification (#131)

Implements plan `plans/2026-08-27-camp-008-outbound-status-and-claim-button.md`
§D1 / Stream A: `classifyWebhookKind` and `normalizeStatusPayload` in
`src/infrastructure/whatsapp/webhooks.ts` now recognise Kapso **payload v2**
outbound status webhooks (`whatsapp.message.sent/delivered/read/failed`),
which previously fell through to `'inbound'` via `hasKapsoFlatMessage`
(any object with a `message` key) and were silently dropped.

## Files Changed

| File | Lines | Purpose |
|---|---|---|
| `src/infrastructure/whatsapp/webhooks-kapso-v2.ts` | +75 (new) | All v2 logic: `hasKapsoV2OutboundStatus` predicate + `extractKapsoV2Status` selector |
| `src/infrastructure/whatsapp/webhooks.ts` | +10/-2 | Import + one `||` clause in `classifyWebhookKind` (checked before the inbound test) + v2 branch in `normalizeStatusPayload` (checked after Meta, before Kapso-flat) |
| `src/infrastructure/whatsapp/__tests__/fixtures/kapso-v2-{received,sent,delivered,failed-131047}.json` | new | Verbatim Kapso docs examples |
| `src/infrastructure/whatsapp/__tests__/fixtures/kapso-v2-failed-131042.json` | new (revised) | Real prod shape from Kapso's messages API (team-lead-supplied, synthetic phone numbers): single-entry `statuses[]` (Meta-rejected template, no preceding `sent`), `error` carries `href`+`message`+`error_data.details`, `kapso` also carries `phone_number_id`/`whatsapp_conversation_id`/`processing_status: 'processed'`/`content` |
| `src/infrastructure/whatsapp/__tests__/webhooks.test.ts` | +85 | 2 new describe blocks, 11 new tests |
| `src/app/api/webhooks/whatsapp/__tests__/status-handlers.test.ts` | +19 | 2 new tests wiring `normalizeStatusPayload` → `mapStatusUpdate` for the 131042 fixture (status-handlers.ts itself untouched) |

## Key Decisions

- **One entry, not full history.** `extractKapsoV2Status` returns the
  `statuses[]` entry whose `status === kapso.status` (last match wins), else
  the last entry, else a synthesised `{id, status, timestamp, recipient_id}`
  from `message.id/kapso.status/message.timestamp/message.to`. Matches plan
  D1 exactly — replaying the whole `statuses[]` array would re-claim
  `${id}:sent` idempotency keys on every later delivered/read/failed webhook
  for no benefit, since the lattice already ignores regressions.
- **Reused `toNormalizedStatus`** (existing private helper in `webhooks.ts`)
  to convert the raw v2 entry into `NormalizedStatus` rather than duplicating
  id/status/timestamp/recipientId/errors extraction — the v2 `statuses[]`
  entries and the synthesised fallback both already use the same
  `recipient_id` snake_case key the flat-Kapso path uses, so no adapter was
  needed.
- **Predicate order**: `hasKapsoV2OutboundStatus` requires
  `message.kapso.direction === 'outbound'` AND (`statuses[]` non-empty OR
  `kapso.status` is a string). An outbound message with *neither* signal
  (e.g. a bare ack) falls through to `hasKapsoFlatMessage` → classified
  `'inbound'`, per plan's acceptance criterion 6 ("not classified as
  status" — it doesn't have to become `'other'`).
- **File-size note**: the brief asked to keep `webhooks.ts` under 150 lines
  by splitting v2 logic out. It was already at 167 lines before this task
  (pre-existing, not introduced here); my diff adds ~10 lines to it
  (import + 1 classify clause + a 6-line normalize branch), landing at 177.
  All actual v2 logic (75 lines) lives in the new file. I did not touch the
  pre-existing 167 lines to bring the file under the target — that would be
  a non-surgical refactor outside this task's diff.

## Tests

11 new tests in `webhooks.test.ts` (all TDD: written first, watched fail —
8 failures observed pre-implementation — then made green):
- `classifyWebhookKind — Kapso v2 outbound status (CAMP-008 / #131)`: sent/delivered/failed → `'status'`; received → `'inbound'`; outbound-with-neither-signal → not `'status'`.
- `normalizeStatusPayload — Kapso v2 outbound status (CAMP-008 / #131)`: failed-131047 (length 1, id/status/errors[0].code/recipientId/timestamp asserted), delivered (picks the matching entry, not history), sent, synthesised-entry-from-message-fields, received → `[]`, outbound-with-neither-signal → `[]`.

2 new tests in `status-handlers.test.ts` (updated after the team lead
supplied the real prod 131042 shape — fixture replaced, assertions revised
accordingly):
- `mapStatusUpdate` end-to-end over `normalizeStatusPayload(kapsoV2Failed131042)` → `errorCode '131042'`, `errorTitle 'Business eligibility payment issue'`, `errorDetails` = the real `error_data.details` string.
- Explicit assertion that the normalised entry's `errors[0].error_data.details` (snake_case) is what `mapStatusUpdate`'s `errorDetails` reads — proves `extractErrorDetails` in `status-mapper.ts` handles the real prod shape (single-entry `statuses[]`, no preceding `sent`) with zero code changes.

Confirms the existing `status-mapper.ts` needs no changes — it already reads
`error_data`/`errorData` defensively, and `extractKapsoV2Status`'s
"last-match" selection works unmodified on a single-entry `statuses[]` array.

All 30+ pre-existing tests in `webhooks.test.ts` and all pre-existing tests
in `status-handlers.test.ts` pass unchanged (no modifications to existing
test bodies, only additive imports + new describe blocks/tests).

Commands run (all green, re-verified after the fixture revision):
- `./node_modules/.bin/vitest run src/infrastructure/whatsapp src/app/api/webhooks/whatsapp/__tests__/status-handlers.test.ts` → **8 test files passed, 111/111 tests passed**
- `./node_modules/.bin/vitest run src/infrastructure src/app/api/webhooks` (broader regression sweep) → **102 files passed / 4 skipped, 1165/1188 tests passed (21 skipped, 2 todo — pre-existing, unrelated to this change)**
- `./node_modules/.bin/tsc --noEmit` → clean, 0 errors (whole project)
- `./node_modules/.bin/eslint <all changed .ts/.json files>` → **0 errors** (5 warnings on the new `.json` fixtures are "file ignored, no matching lint config" — expected, JSON isn't linted in this project; not a failure)

## Deferred / Tech Debt

- `webhooks.ts` remains at 177 lines (pre-existing 167 + my 10-line delta),
  above the 150-line target. Bringing it under 150 would require refactoring
  the pre-existing Meta/quality/template-status glue, which is out of scope
  for this surgical change — flagging for a future cleanup pass, not doing
  it here.
- Per plan D2/D3 (Stream B), nothing yet retracts `chargeable_sent_count` or
  flips a campaign to `failed` on this newly-classified async failure —
  that's Stream B's job, dispatched separately.

## Review Hand-off

- Boundary respected: did not touch `route.ts`, `status-handlers.ts` logic
  (only added one test), `src/infrastructure/kapso/webhook-parser.ts`, or
  anything under `src/application/`.
- Worth a second look: `extractKapsoV2Status`'s "last match wins" selection
  when `kapso.status` doesn't match ANY entry in `statuses[]` (defensive
  fallback to the last entry) — still untested directly, since neither the
  Kapso doc examples nor the real prod 131042 shape (team-lead-supplied)
  exhibit that case. Low risk (defensive-only path) but noting it as an
  untested edge for the review gate.
- The real prod 131042 payload confirmed a case my synthesised-fallback
  branch didn't need to handle: a Meta-rejected template's `statuses[]` can
  contain a SINGLE entry (no preceding `sent`). `extractKapsoV2Status`
  already handled this correctly with no code change (verified by re-running
  the suite after the fixture swap) — the "last match" search over a
  length-1 array degrades to trivially returning that one entry.
- No changes to `status-mapper.ts` were needed — the 131042 test proves the
  existing `error_data`/`errorData` dual-read already covers the v2 error
  shape.
