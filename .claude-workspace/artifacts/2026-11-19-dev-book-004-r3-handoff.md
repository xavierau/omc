---
id: artifacts/2026-11-19-dev-book-004-r3-handoff
type: handoff
contract: handoff-file-v1
author: dev
created: 2026-11-19
status: active
supersedes: artifacts/2026-11-19-dev-book-004-r2-handoff
superseded_by: null
item: BOOK-004
state: done
brief: inline (brief-v1 BOOK-004 r3, 2026-11-19: fix the seven /code-review findings on PR #196)
base: 8f2bd00d
head: 3c9aa3ec (code) + this docs commit
branch: feature/bookings-calendar-table
pushed: true
stage: poc (WT_STAGE=poc, slot 3)
gate: {result: pass, at: 2026-11-19, note: "tsc --noEmit clean + full vitest 645 files / 7286 tests passed (11 files skipped) under the heavy lock; eslint on the 11 changed TS/TSX files exit 0"}
next: {owner: verifier, action: "re-review of 8f2bd00d..3c9aa3ec against the seven findings, then merge PR #196 into develop"}
blockers: []
refs: [artifacts/2026-11-19-book-004-bookings-views-impl, artifacts/2026-11-19-book-004-bookings-views-ux, artifacts/2026-11-19-dev-book-004-r2-handoff]
---
ac:
  AC-1: {result: pass, evidence: "evidence/2026-11-19-book-004-r3/ac1-red.log: 19 failing at 8f2bd00d (tests only); ac1-green.log: 73 files / 914 tests passed, 8 DB files skipped (RUN_DB_TESTS unset), over the 4 brief dirs + the repository unit test"}
  AC-2: {result: pass, evidence: "ac2-gate.log (tsc + full vitest, exit 0: 645 files / 7286 tests); ac2-lint-changed-files.log empty, exit 0"}
  AC-3: {result: pass, evidence: "ac3-walk.log + 3 screenshots, zh-HK (env-fixed locale): 390 Show pill -> Table (Pending on) -> Calendar lists all 3 bookings of 19 Nov (pending, confirmed, declined); 1440 Confirm + Next month 300 ms later with the POST delayed 2.5 s -> ends on 2026年12月, no Loading, the decision's refetch fetched the December range; F5 counts and no-match also seen at 1440. Seed removed by id (ac3-cleanup.log)"}
  AC-4: {result: pass, evidence: "3c9aa3ec + docs commit pushed; ls-remote sha == HEAD (see dev return); findings table below"}
findings:
  - {id: F1, fix: "BOOKINGS_RANGE_CAP 1000 -> 999 (domain, with the max_rows reason) and the repository clamps any cap to max_rows - 1 (readCap) before limit(cap + 1), in both listBookingRequestsInRange and listPendingBookingRequests; cappedList shared", test: "bookings-range.test.ts: the in-memory PostgREST fake now returns at most MAX_ROWS = 1000 rows whatever limit asks; new 'range longer than max_rows is flagged truncated' + 'pending ... (F1)'; the two existing R4 cap tests also went red under the enforcing fake at base"}
  - {id: F2, fix: "use-bookings: bookingsSettler lands a fetch only while its key is keyRef.current (and its effect is active); refetch reloads keyRef.current, not the key of the render that made it", test: "booking-hooks.test.ts 'useBookings settle (F2)': refetch for November in flight, query moves to December, December lands, November lands last -> last landed is December; an old key's failure never sets the error"}
  - {id: F3, fix: "mechanism: bypass (not reset). bookingsPageLists: filtersShown = !(calendar && isPhone); shown = all when the filters are hidden. The user's filter survives a return to Table", test: "bookings-screen.test.tsx F3 (phone Calendar, status pending + query set -> both rows of the day render, no day-empty); bookings-views-helpers.test.ts bookingsPageLists F3"}
  - {id: F4, fix: "runDecision: setBusyId(id) -> decide -> onOutcome -> await refetch, setBusyId(null) in finally", test: "booking-hooks.test.ts runDecision: busy stays 'b1' while refetch is pending, cleared after; cleared when refetch throws"}
  - {id: F5, fix: "bookingsPageLists: Calendar counts + monthEmpty from the selected month only (no grid spill-over); dayHidden -> CalendarDayPanel shows bookings-no-match / noMatch copy", test: "bookings-screen.test.tsx: chips count November only; spill-over-only month shows booking-list-empty; filter-emptied day shows bookings-no-match. Helpers test covers counts, scopeEmpty, dayHidden"}
  - {id: F6, fix: "matchesSearch: phone match only when the query matches /^[\\d\\s+()-]+$/", test: "bookings-views-helpers.test.ts: 'Chan 6', 'Au 4455', 'Chan 9' no longer match; '+852 6123-4455', '(852) 6123' still do"}
  - {id: F7, fix: "removed bookings.partyOf, bookings.emptyTitle, bookings.emptyDescription from en.json and zh-HK.json", test: "grep first: no reference in src outside messages (the remaining emptyTitle/emptyDescription users are the integrations and agentLog namespaces); the full suite stays green"}
decisions:
  - "F1: cap value + clamp, not count:'exact': no extra count query, the existing cap+1 shape stays; the clamp keeps the repository correct for any caller cap"
  - "F2: current-key ref guard, not a per-key store; and refetch follows the current key, so a decision made before a month change also refreshes the month now on screen"
  - "F3: bypass the hidden filters on phone Calendar instead of resetting status/query, so Show -> Calendar -> Table keeps the Pending filter the owner chose for Show"
  - "F5: on phone the week strip can cross into the next month; month-empty and counts still follow the selected day's month"
  - "Commit type fix: (defects found in review of unmerged work). No debugging journal: debugging_journals/ is outside files_allowed; see open question in the dev return"
failed:
  - tried: "useMemo(() => bookingsSettler(() => keyRef.current, ...))"
    why: "react-hooks/refs (React Compiler lint): passing a ref-reading function during render"
    evidence: "eslint error 'Cannot access refs during render' on use-bookings.ts"
    replaced_by: "settle as a useCallback whose body builds the settler, so the ref is read only in effects and handlers"
invariants:
  - "Every dashboard booking read is scoped by restaurant_id in the query (R1); unchanged"
  - "Unverified bookings never reach staff views (R2): range list status allow-list and pending eq(status) unchanged"
  - "Search text never enters the URL (R6); unchanged"
unverified:
  - "The F2 walk could not replay the old bug's ordering: with the fix, the refetch asks for the current range, so no stale November GET was issued. The ordering itself is unit-tested (bookingsSettler)"
  - "The hook wiring (keyRef effect order, refetch identity) is not unit-tested: no DOM renderer in the repo (no jsdom/testing-library); covered by the 1440 walk only"
  - "en rendering not walked this round (locale is env-fixed to zh-HK locally); no new strings were added"
  - "F1 against hosted PostgREST: max_rows = 1000 taken from supabase/config.toml and the brief, not probed on the hosted project"
review_focus:
  - "src/hooks/use-bookings.ts: keyRef effect declared before the fetch effect; refetch no longer depends on key"
  - "src/components/dashboard/bookings/booking-groups.ts bookingsPageLists: phone Calendar bypass, month scope"
scope_drift:
  - "CLAUDE.md: next dev re-added its nextjs-agent-rules block; restored, not committed (as r2)"
next_step: "Re-review PR #196 against F1-F7, then merge into develop."
---
Notes:
- Walk: local Supabase CLI stack (54321/54322), `next dev -p 3030` with the local URL/keys in the process env (overriding .env.local, which points at a hosted project). Scratch tenant b0040000-…0043, user book004-r3-staff@example.test, 7 bookings; all deleted by exact id afterwards: restaurant 0, bookings 0, user 0, the other tenant's 3 rows untouched.
- Impeccable source detector on src/components/dashboard/bookings: exit 0, [] (evidence/…/detector.json). The rendered-route detector needs a signed-in session and was not run.
- Rot seen, not repaired: .claude-workspace/INDEX.md is 257 lines (budget ~50-60; the context-budget hook flags it). `handoffs.md` does not exist in this workspace.
