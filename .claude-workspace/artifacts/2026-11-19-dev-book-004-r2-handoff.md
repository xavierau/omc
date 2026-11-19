---
id: artifacts/2026-11-19-dev-book-004-r2-handoff
type: handoff
contract: handoff-file-v1
author: dev
created: 2026-11-19
status: superseded
supersedes: artifacts/2026-11-19-dev-book-004-handoff
superseded_by: artifacts/2026-11-19-dev-book-004-r3-handoff
item: BOOK-004
state: done
brief: inline (brief-v1 BOOK-004 r2, 2026-11-19)
base: a770b390
head: 8c07b365
branch: feature/bookings-calendar-table
pushed: true
stage: poc (WT_STAGE=poc, slot 3)
gate: {result: pass, at: 2026-11-19T09:56Z, note: "tsc + full vitest green under the heavy lock; eslint on the 11 changed TS files exit 0; repo-wide lint debt accepted (owner decision 2) → LINT-001"}
next: {owner: verifier, action: "code review of a770b390..HEAD (r2) or 49a3f582..HEAD (whole PR #196)"}
blockers: []
refs: [artifacts/2026-11-19-book-004-bookings-views-impl, artifacts/2026-11-19-book-004-bookings-views-ux]
---
ac:
  AC-1: {result: pass, evidence: "npx vitest run src/app/api/dashboard/bookings/__tests__ src/components/dashboard/__tests__ src/hooks/__tests__ → 70 files / 881 tests (evidence/2026-11-19-book-004-r2/ac1-green.log); red first ac1-red.log, 10 failing; the Show chain test runs SHOW_PENDING → fetchRange → fetchBookings → the real route + repository and asserts bookings.length === pendingCount with a past-dated row"}
  AC-2: {result: pass, evidence: "ac2-gate.log: tsc --noEmit clean, vitest 644 files / 7268 tests passed (11 files skipped); ac2-lint-changed-files.log empty, exit 0"}
  AC-3: {result: pass, evidence: "ac3-needs-reply-show-1440-en.jpeg: pill '5 requests need a reply' → Show → ?view=table, range 'Needs a reply', chip Pending 5, 5 rows: Fri Oct 2 and Sun Nov 15 (past-dated) first, unverified seed absent; ac3-needs-reply-show-390-en.jpeg same 5 cards; geometry probes: no h-overflow at 1440/390, select unclipped, 5 unique row ids"}
  AC-4: {result: pass, evidence: "8c07b365 pushed, ls-remote sha == HEAD (see dev return); kanban LINT-001 + BOOK-005 in backlog, BOOK-004 notes + artifacts updated; this file"}
decisions:
  - "Additive API param ?status=pending, not the no-param list filtered on the client: the no-param list also fetches 200 decided rows ordered by created_at. The new mode uses the same filter as the count, in booking order, under the existing 1000 cap"
  - "status accepts only 'pending' and never with from/to: 400 {error:'invalid_status'}. invalid_range is unchanged for bad from/to"
  - "Third table range 'Needs a reply' / '待回覆' in the existing select, soonest first. Its footer reads 'Showing N bookings that need a reply' and its button goes to Upcoming"
  - "Commit type feat, not fix: an owner-chosen behaviour change to unmerged work, not a defect in shipped code (so no debugging journal)"
failed:
  - tried: "chrome-devtools screenshots/audit into the worktree or scratchpad"
    why: "the MCP writes only under the main checkout root"
    evidence: "Access denied: path ... is not within any of the configured workspace roots"
    replaced_by: "relative filePath (lands in the main checkout root), then moved into evidence at once; nothing left there"
invariants:
  - "Every booking_requests read for the dashboard is scoped by restaurant_id inside the query (R1)"
  - "Unverified bookings never reach staff views (R2): the pending list is eq(status,'pending')"
  - "Search text never enters the URL (R6)"
unverified:
  - "Full layout-audit.js run on the r2 state: the MCP cannot read it by path, and r2 adds no new layout. Owner: verifier vision, if wanted"
  - "zh-HK rendering of the three new strings (unit-tested by key only; not walked)"
  - "Rendered-route Impeccable detector (needs a signed-in session); the source detector on src/components/dashboard/bookings gave exit 0, []"
review_focus:
  - "src/app/api/dashboard/bookings/route.ts parseListQuery: status vs range precedence"
  - "src/hooks/use-bookings.ts useBookings: keyed by the query's search string"
scope_drift: []
next_step: "Review PR #196, then merge into develop. LINT-001 and BOOK-005 wait in the backlog."
---
Notes:
- Local walk used the shared Supabase CLI stack (54321) with a scratch tenant b0040000-…0042, a user and 8 bookings. All were deleted by exact id after the run: restaurant 0, bookings 0, user 0, the other tenant's 3 rows untouched (ac3-cleanup.log).
- `next dev` re-adds a "nextjs-agent-rules" block to CLAUDE.md. It is outside files_allowed, so it was restored, not committed.
- LINT-001 counts: the r1 log lists 131 files and 78 of them have errors. The brief said 92 untouched files. The card records both.
