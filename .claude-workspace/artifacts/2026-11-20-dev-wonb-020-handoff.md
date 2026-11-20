---
id: artifacts/2026-11-20-dev-wonb-020-handoff
type: artifact
author: dev
created: 2026-11-20
status: active
supersedes: null
superseded_by: null
related: [kanban:WONB-020, github:212]
---
# WONB-020 handoff (dev)

Stage: **POC** (repo has no mature import). Tree `../whatsapp-crm--wonb-020`, branch `feature/wonb-020-imported-welcome-claim`, base 7bbe622f (equals origin/develop at start; no equivalent change on develop). Code commit 425f2836. PR https://github.com/xavierau/omc/pull/212 into develop, not merged.

## What changed
| file | purpose |
|---|---|
| src/infrastructure/supabase/repositories/event-repository.ts | `hasJoinEvent(restaurantId, memberId)`: events where restaurant + member + type 'join', `limit(1)`; throws on DB error |
| src/application/has-join-event.ts | `canClaimWelcome`: true only when the lookup succeeds and finds no join event; an error leads to false plus `console.warn('[onboarding] join-event lookup failed…')` |
| src/application/register-member.ts | an existing member who can claim goes to `claimWelcomeForExisting`, which calls `onboardNewMember` (stored name, else contactName; stored preferred_language), returns `isNew:false` + couponCode. The try/fallback is extracted to `runOnboarding`, shared with new members (same minimal-welcome fallback). Race path (23505) unchanged: welcome-back |
| src/application/register-member-web.ts | pre-check selects `id, name`. An existing member who can claim goes to `mintWelcome` (extracted from the new-member path: campaign coupon or welcome coupon, then the join event), returns `isNew:false` + couponCode |
| src/app/api/join/[slug]/route.ts | `{couponCode}` when `isNew || couponCode`, else `{existing:true}` |
| tests | register-member (+6), register-member-web (+5), has-join-event (4, new), api/join route (3, new) |

## Decisions (decide_yourself)
- Lookup: repository query in event-repository.ts, plus the fail-safe policy in application/has-join-event.ts.
- No `claimed_existing` tag on the join event. The WhatsApp join event is written inside onboard-new-member.ts, which is outside files_allowed, and tagging only the web path would be inconsistent. Claims can be recognised as a join event later than the member's `joined_at`.
- No concurrency guard. A real guard needs a partial unique index on `events(member_id) where type='join'`, which is a migration outside files_allowed. The race is listed below.

## Escalation check (fixed rule)
Every member-creation path goes through `createOrGetMember`, and each writes a join event: WhatsApp (onboardNewMember), web (mintWelcome), partner API (process-member-create-job.ts:321, on `created` regardless of the welcome decision). The exception is import (consent_imported only), which is the intended target. No escalation.
Edge cases where "no join event" does not mean "never got a coupon":
- (a) WhatsApp onboarding where the coupon mint succeeded but the `events` insert failed.
- (b) Members created before join events were written. The events table is in 001, so this is unlikely.

## Acceptance
- AC-1 PASS: `npx vitest run src/application/__tests__/register-member.test.ts`. Covers "AC-1: runs the welcome flow…" and "…falls back to the WhatsApp contact name…".
- AC-2 PASS: same file, "AC-2: a member WITH a join event gets welcome-back only".
- AC-3 PASS: `npx vitest run src/application/__tests__/register-member-web.test.ts "src/app/api/join/[slug]/__tests__/route.test.ts"`. Covers the AC-3 cases for mint, join-event order, the stored-name campaign path, and with-join-event → `{existing:true}`.
- AC-4 PASS: both files, AC-4 tests with a stateful join-event fake. Exactly one coupon is minted across two joins.
- AC-5 PASS: both files, plus has-join-event.test.ts. A rejected lookup mints nothing, gives welcome-back / `{existing:true}`, and warns.
- red_first: before the implementation, all 3 target files failed (`hasJoinEvent` missing; the route AC-3 test got `{existing:true}`).
- AC-6 PASS, run once under the heavy lock:
  - `npx vitest run`: 665 files passed / 14 skipped, 7602 tests passed / 127 skipped, exit 0.
  - `npx tsc --noEmit`: no output.
  - `eslint` on the 9 touched files: no output.
- AC-7 PASS (evidence log below). Local `next dev -p 3207` with `.env.local` (DEV project), restaurant `omc-kitchen`:
  - Seeded member `b694c296-…` (+85290002020, no join event). The `consent_imported` event could not be seeded because the DEV events_type_check is behind, which does not affect the rule.
  - POST 1 → `{"couponCode":"AH2XT3"} HTTP 200`. DB: one coupon on the mapped welcome campaign and one `join` event `{source:web, coupon_code:AH2XT3, campaign_id:…}`.
  - POST 2 → `{"existing":true} HTTP 200`.
  - Cleanup, run-created ids only: event 8346b235, coupon 3aa42292, member b694c296, and the campaign `non_chargeable_sent_count` back 1 → 0. It was the only coupon on that campaign, so the 1 was this run's increment. The phone now has no member.
- AC-8 PASS: PR #212 is open; kanban WONB-020 is in review and links the PR; the poc-log line is appended.

## Unverified
- WhatsApp JOIN for an imported member on a real number (no Kapso locally). Covered by unit tests only.
- Concurrent claims: two simultaneous JOINs or form submits for the same never-welcomed member can both pass the lookup and mint two coupons.
- Kapso webhook retries are sequential: after a claim, a retry sees the join event and gets welcome-back.

## Notes
- `next dev` rewrote CLAUDE.md, adding a nextjs-agent-rules block. I reverted it; it is not in the diff.
- `npm ci` was run in the tree (no symlinked node_modules).
- Suite unchanged after freeze: no test was weakened or removed. Existing tests got a default `hasJoinEvent → true` mock so they keep their welcome-back semantics.

next_step: review and merge PR #212 into develop, then release. After release, the owner checks that an imported member on prod gets the welcome by scanning the join QR.
