---
id: artifacts/2026-11-19-agent-003-fix2-handoff
type: handoff
contract: handoff-file-v1
author: dev
created: 2026-11-19
status: active
item: AGENT-003-FIX2
state: done
brief: inline (team-lead, AGENT-003-FIX2 brief-v1)
base: 8fa46bf2
branch: feature/agent-003-agent-booking
pr: https://github.com/xavierau/omc/pull/195 (into develop, not merged)
stage: poc
suite_changed: true (tests added only; the psql mirror of cancelDinerBooking follows the new filter)
gate: {result: pass, at: 2026-11-19T12:58Z}
next: {owner: main, action: "release per artifacts/2026-11-19-agent-003-fix1-handoff: migration 085 FIRST, then worker restart, then tick the booking tools for omc; run the real-DB F10/N2 block when the supabase lock is free"}
blockers: []
refs: [reviews/2026-11-19-agent-003-rereview, artifacts/2026-11-19-agent-003-fix1-handoff, kanban:AGENT-003]
---
# AGENT-003 fix round r5: re-review N1 and N2

Fake data only; nothing touched prod or the local Supabase stack.

## ac
- **AC-N1: pass.** `npx vitest run -t AC-N1`: 3 passed (`src/application/__tests__/agent-003-rereview-fixes.test.ts`).
  - `respondToJobError` (`src/application/agent/process-agent-reply.ts`) catches a THROWING handoff claim and sends `fallback()` (the menu, no row, as on the menu path). A claim that returns false (`taken`, another run answered) still returns with no send.
  - Tests: the reviewer's repro (row insert throws in deliver, then again in the handoff claim) → 1 menu, 0 sends; model error + claim throws → 1 menu, 0 sends; claim taken → 0 menus, 0 sends.
  - Red before the fix: the two throw cases failed (`fallbacks` 0); the taken case passed before and after.
- **AC-N2: pass.** `npx vitest run -t AC-N2`: 3 passed, 1 skipped (the real-PostgREST case, inside the existing skipped block).
  - New `dinerCancelFilter(id, from)` in `booking-request-repository.ts` = `and(id.eq.X,or(<upcoming>)),and(replaces_booking_id.eq.X,status.eq.pending)`; `cancelDinerBooking` uses it in its `.or(...)`. Restaurant, phone and open-status scoping unchanged.
  - The fake (`src/test-utils/fake-booking.ts`) and the psql mirror (`agent-booking-changes.db.test.ts` `dinerCancel`) apply "upcoming" to the target only.
  - Tests: target tomorrow + pending change request today 12:00, clock 21:00 HK → both cancelled; target today 12:00 at 21:00 → `[]`, still confirmed (F10 kept); the filter string. Red before the fix: the first and third failed.
- **AC-GATE: pass.** `resource-lock.py heavy -- bash -c 'npx tsc --noEmit && npx vitest run'` exit 0: 648 files passed (13 skipped), 7348 tests passed, 94 skipped, 2 todo. Fix1 was 647/7342/93; the delta is the new file (+6) and the skipped real-DB AC-N2 case (+1 skipped). No test removed. ESLint `--quiet` on the touched files exits 0.
- **AC-PR:** see the dev's return block (ls-remote SHA == HEAD).

## unverified
- The real-DB block in `agent-booking-changes.db.test.ts` (including the new AC-N2 case and the edited psql mirror) did not run: the brief forbids the supabase lock and the local stack. The PostgREST nesting is the same shape fix1 parse-probed (`and(...,or(...))` inside `or=`), not re-probed.

## notes
- N3 not fixed (owner-accepted nit).
- With the new filter, cancelling a target that is NOT upcoming still cancels its pending change rows. The tool never reaches the UPDATE for such a target (`confirmCancel` re-lists upcoming first with the same `hkNow`, and requires the target id in the result), so this only matters inside the same minute.
