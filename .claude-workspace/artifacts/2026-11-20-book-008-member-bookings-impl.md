---
id: artifacts/2026-11-20-book-008-member-bookings-impl
type: artifact
author: dev
created: 2026-11-20
status: active
supersedes: null
superseded_by: null
related: [threats/2026-11-20-book-007-008-member-bookings, plans/2026-11-20-book-007-008-member-bookings, kanban:BOOK-008, kanban:BOOK-007]
---

# BOOK-008 implementation note: members ↔ bookings

Stage: POC. Branch `feature/book-008-member-bookings` from 460d9490.

## Files Changed
| file | purpose |
|---|---|
| `supabase/migrations/088_booking_member_backfill.sql` (new) | `events_type_check` + `booking.member_relinked` (081 list + 1 = 21); index `(restaurant_id, member_id, booking_date DESC, booking_time DESC) WHERE member_id IS NOT NULL`; RPC `relink_booking_member` (one statement: CAS UPDATE + events row, R2/R4); RPC `member_booking_stats` (R8); both service_role only; one-off backfill UPDATE (R1). Idempotent. |
| `src/domain/entities/member-booking.ts` (new) | `MemberBookingItem`, `MemberBookingStats`, `MemberBookingHistory`, `MEMBER_BOOKINGS_LIMIT = 50`, event type constant |
| `src/domain/ports/booking-member.ts` (new) | `BookingMemberLinkStore` (findBooking, memberExists, relink), `MemberBookingsReader` (list, stats) |
| `src/domain/ports/booking.ts` | `AgentBookingStore.linkMember` |
| `src/domain/entities/event.ts` | `EventType` + `booking.member_relinked` |
| `src/application/booking/relink-booking-member.ts` (new) | use case: UUID check, scoped booking + member, no-op when unchanged, CAS relink → `conflict` |
| `src/application/booking/get-member-booking-history.ts` (new) | list (50) + stats in parallel, Hong Kong now; never throws (null) |
| `src/application/booking/member-booking-deps.ts` (new) | composition for the two use cases, apart from booking-deps (members route stays light) |
| `src/application/booking/verify-agent-booking.ts` | after promotion: `findMemberId` by phone → `linkMember` (best effort, logged by error name) |
| `src/application/booking/booking-deps.ts` | `verifyAgentBookingDeps` gets `members` |
| `src/infrastructure/supabase/repositories/booking-member-repository.ts` (new) | `memberExistsForRestaurant`, `relinkBookingMember` (RPC), `listMemberBookings`, `memberBookingStats` (RPC) |
| `src/infrastructure/supabase/repositories/agent-booking-repository.ts` | `linkAgentBookingMember`: UPDATE member_id WHERE id, restaurant, member_id IS NULL, status <> unverified |
| `src/infrastructure/supabase/repositories/booking-request-repository.ts` | `STAFF_COLUMNS` exported (relink RPC returns the same columns) |
| `src/app/api/dashboard/bookings/[id]/member/route.ts` (new) | PATCH `{memberId: uuid \| null}`; admin/staff else 403; 400 bad body; 404 miss; 409 changed |
| `src/app/api/dashboard/members/route.ts` | member detail GET adds `bookingHistory` (UUID ids only), in parallel with the detail |
| `src/components/dashboard/member-bookings-section.tsx` (new) | stats grid + newest list + "showing latest N of M"; empty / unavailable lines |
| `src/components/dashboard/member-detail-panel.tsx` | Bookings section after quality evidence |
| `src/components/dashboard/bookings/use-booking-member.ts` (new) | `searchMembers`, `startMemberSearch` (debounce + cancel), `requestMemberLink`, `memberLinkOutcome`, `memberLinkAction`, `useBookingMemberLink`, `BookingMemberContext` |
| `src/components/dashboard/bookings/booking-member.tsx` (new) | `BookingGuestName`, `MemberLinkControl` (+ inline picker), `SearchResults`, `MemberLinkNoticeLine` |
| `booking-row.tsx`, `bookings-table-desktop.tsx`, `bookings-table-cards.tsx`, `bookings-screen.tsx` | name → `BookingGuestName`, `MemberLinkControl` per view; screen provides the context, the failure notice and a `MemberDetailPanel` |
| `src/messages/en.json`, `zh-HK.json` | 12 `members.*` + 10 `bookings.*` strings |
| `src/test-utils/fake-booking-member.ts` (new) | `FakeMemberDirectory`, `FakeBookingMemberLinks` (mirrors the RPC), `FakeMemberBookings` |
| tests | see Tests |

## Key Decisions
- **Poppy link = follow-up scoped UPDATE**, not inside `promote_agent_booking`: no change to the 084 RPC, the link works before 088 is applied, and a failed link never costs the diner the acknowledgement. The returned booking carries the member id into the "received" send (the sender ignores it: R3).
- **Relink is one RPC** (`relink_booking_member`) so the member change and its audit row commit together, and the row only changes while it still holds the member the caller read (CAS). A lost race answers 409 `changed`; the UI reloads and says the link did not go through.
- **No-op relink** (same member / already unlinked) answers 200 with no events row and no write.
- **Events row**: `member_id` NULL, `data_json` `{bookingId, fromMemberId, toMemberId}`, `actor_user_id` = session user. Written with a plain INSERT in SQL, not `emitEvent`, so no tenant listener or outbound integration receives it.
- **Stats via RPC** (`member_booking_stats`, LANGUAGE sql STABLE, one row always). Last = latest booking date before the Hong Kong minute, any status; next = earliest pending/confirmed from it on (same past rule as 087).
- **Degrade OFF**: a failed bookings read (e.g. 088 not applied yet) gives `bookingHistory: null`; the panel says "couldn't load bookings" and the rest of the member detail loads (memory principle_shared_select_migration_coupling).
- **Member search for the picker**: the brief points at `members/lookup` (exact E.164 phone → `{memberId}` only); a picker needs names and partial matches, so the picker uses the existing members list search `GET /api/dashboard/members?search=&pageSize=8&sortBy=name` (same tenant scope, name or phone). Lookup route unchanged.
- **Body validation**: a body without a string-or-null `memberId` is 400 (not 404); a non-UUID string is 404 as the brief says.
- **R7**: the BOOK-001 page body and the agent API body already refuse unknown fields (`member_id`/`memberId` → invalid, nothing stored); tests pin it. Agent tool declarations contain no member field (test).
- Change requests copy the original's `memberId` (AGENT-003, unchanged): a staff relink carries over to a later change request.

## Tests
- AC-1 `src/application/booking/__tests__/booking-member-linking.test.ts` 11 (red: `ac1-red.log`, 4 failed).
- AC-2 `src/app/api/dashboard/bookings/__tests__/bookings-member-link.test.ts` 17 (red: `ac2-red.log`, route missing).
- AC-3 `src/app/api/dashboard/members/__tests__/member-bookings.test.ts` 8 (red: `ac3-red.log`, 6 failed), `.../repositories/__tests__/booking-member-repository.test.ts` 7, `booking-member-migration-contract.test.ts` 6.
- AC-4 `src/application/booking/__tests__/booking-member-r3.test.ts` 5.
- AC-5 `src/components/dashboard/__tests__/booking-member-ui.test.tsx` 22 (written after the components: no red run, see handoff).
- Existing tests changed (spec additions, nothing weakened): members `route.test.ts` happy-path payload + `bookingHistory: null`; `agent-booking-lifecycle.test.ts` and `booking-confirm-code.test.ts` pass a `members` dep (no member, linking covered by AC-1).
- AC-6 scratch DB: `evidence/2026-11-20-book-008/ac6-088-scratch.{sql,log}`.
- AC-7 gate: `tsc --noEmit && vitest run` under the heavy lock, exit 0, 676 files / 7734 tests (`ac7-gate.log`).

## Design Gate
`impeccable detect --json` on the 7 changed UI files: exit 0, `[]` (`evidence/.../design-detect.json`). Rendered pass not run on a live route (no authenticated local app); AC-8 renders checked instead: 390 scrollWidth 390 in en and zh-HK, link buttons 28px, cursor pointer.

## Visual Verification Hand-off
Entry path: dashboard nav → 訂座 / Bookings (table or calendar day panel) → a linked booking's name → member panel; or 會員 / Members → a member → Bookings section. Evidence: `evidence/2026-11-20-book-008/ac8-{en,zh-HK}-{desktop-1440,phone-390}.png`, `ac8-checks.log`, harness `ac8-render.tsx.txt` (real components + messages + compiled CSS over fakes; not the running app; the member panel's section rendered at the Sheet width, not inside the Sheet).

## Review Hand-off
- Migration 088 must be applied before the code ships (the relink writes the new event type and calls the RPC; stats degrade to null without it).
- Release window (CodeRabbit PR #214): a poppy booking verified by the OLD code between 088 and the new deploy is not linked. 088 is idempotent, so the release re-runs it once after the new code is live (its backfill links exactly those rows, nothing else changes).
- CodeRabbit PR #214 (minor, not fixed): `useBookings` (`src/hooks/use-bookings.ts`, outside files_allowed) can land an older refetch over a newer one for the same range; the member-link actions add refetches. Pre-existing in the shared hook; fix = a generation counter in its settle path.
- `relink_booking_member` is a data-modifying CTE: the events INSERT reads `changed`, so it writes only for a changed row (scratch log: 3 rows for 3 changes, 0 for 5 refusals).
- The picker reuses the members list endpoint, which any tenant role can read (as today); the PATCH requires admin/staff.

## Deferred / Tech Debt
- No Playwright spec / layout harness in this repo (no `harness.md`); render tests + static renders instead (POC, as BOOK-006/007).
- `member-detail-panel.tsx:150` eslint `react-hooks/set-state-in-effect` is pre-existing (unchanged fetch effect).
- `.claude-workspace/poc-log.md` entry not written (outside files_allowed); the release records PR should add it.
- The events feed (`/dashboard/feed`) will list `booking.member_relinked` rows with the raw type label, as it does for stamp/consent events.
