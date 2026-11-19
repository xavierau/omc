---
id: artifacts/2026-11-19-agent-003-fix1-handoff
type: handoff
contract: handoff-file-v1
author: dev
created: 2026-11-19
status: active
item: AGENT-003-FIX1
state: done
brief: inline (team-lead, AGENT-003-FIX1 brief-v1, fix round r4)
base: c75d682c
branch: feature/agent-003-agent-booking
pr: https://github.com/xavierau/omc/pull/195 (into develop, not merged)
stage: poc
suite_changed: true (only where a fix changed behaviour; listed under AC-GATE)
gate: {result: pass, at: 2026-11-19T10:37Z}
next: {owner: main, action: "re-review PR #195; release = migration 085 FIRST, then worker restart; tick the booking tools for omc in Advanced (F4: they are off by default now)"}
blockers: []
refs: [reviews/2026-11-19-agent-003-code-review, threats/2026-11-19-agent-003-agent-booking, artifacts/2026-11-19-agent-003-handoff, kanban:AGENT-003]
---
# AGENT-003 fix round r4: review findings F1–F10

Evidence: `.claude-workspace/artifacts/2026-11-19-agent-003-evidence/fix1/`. Fake data only; nothing touched prod.

## ac
- **AC-F1: pass.** `vitest run -t AC-F1`: 19 tests (12 in `agent-003-review-fixes.test.ts`, plus filter matches).
  - A proposal is saved under the worker run's id (`owner`), NOT confirmable. The run marks it confirmable only after its own reply was sent (`deliver()`), or in shadow once the draft row is stored (OR5).
  - Every other end of the run discards it, owner-checked: superseded, silenced, window closed, model failure → handoff or menu, send failed → menu, claim lost (duplicate), job error.
  - `peekKind` and `takeIfEarlier` see confirmable proposals only. The R15 contract is unchanged: the not-earlier check runs before the confirmable one, so a same-job take still answers `awaiting_diner_confirmation`.
  - Tested: superseded (also a newer job running *during* the old job's model call), failure → handoff, failure → menu, window closed, send failed, claim lost, job error. Each one: the next "好" gets `no_proposal`, no WAITING line, no booking. A sent read-back → confirm works. Shadow → confirmable after the draft. Another run can't confirm or discard a newer run's proposal.
  - Real Redis 7.2 (throwaway server on :6402): 3 of 3 pass, including the new owner/confirmable Lua (`fix1/redis-real.log`).
- **AC-F2: pass.** In shadow, `offeredTools`/`declarationsFor`/the executor drop `propose_booking_change`, `confirm_booking_change`, `propose_booking_cancel`, `confirm_booking_cancel`. A call to one gets `tool_not_available`: no proposal, no cancel, no text. `list_my_bookings`, `propose_booking`, `create_booking_request` stay. Auto offers all four when enabled.
- **AC-F3: pass.** `isOpenChangeRequest` (domain) = `replacesBookingId` AND `status = 'pending'`. It is used in list (`changeRequestFor`), proposeChange (`not_changeable`, `change_already_pending`) and confirmChange. A confirmed change is listed as a plain booking, and changing it creates a new pending change request. Migration 085 is unchanged: the RPC already requires `status = 'pending'`.
- **AC-F4: pass.** `DEFAULT_ENABLED_TOOLS` = `get_member_summary`, `list_rewards`, `handoff_to_staff`. A config blob without an `enabledTools` array resolves to those three.
- **AC-F5: pass.** `offersProposal` now checks `PROPOSING_TOOLS` (all three propose_*). A cancel-only tool set gets the cancel WAITING line after a sent read-back, and the confirm then cancels.
- **AC-F6: pass (live, no code change needed in the switch).** Live probe with the dev key on 2026-11-19 (`fix1/f6-live-probe.log`, script `fix1/f6-probe.mjs`). Fake data: one `list_rewards` tool.
  - Model A `gemini-3.8-flash` → 200, a functionCall part with a `thoughtSignature`. A 503/429 came first on several runs, so the overload is real.
  - Model B `gemini-3.5-flash-lite`: verbatim **200**, signature stripped **400** ("Function call is missing a thought_signature in functionCall parts"), dummy signature `skip_thought_signature_validator` **200**.
  - Model B `gemini-3.1-flash-lite`: verbatim **200**, stripped **400**, dummy **200**.
  - The same pattern held with `gemini-3.5-flash-lite` ↔ `gemini-3.1-flash-lite` as A.
  - **Conclusion:** the brief's conditional fix ("strip on 400") would *cause* the 400. The client keeps sending the step verbatim. `agent-client.ts` documents why.
  - AC-F6 unit test: main tool step → main 503 → fallback. The fallback request carries the step verbatim, signature included, plus the functionResponse, identical to the main follow-up.
- **AC-F7: pass.** `respondToJobError` replaces `respondToFailure`.
  - If the config was never read, it is read once more. Still unreadable → the menu. Readable → that tenant's `failureAction`.
  - Handoff: the `handoff` row is claimed BEFORE the send (asserted at send time), so the thread `needsStaff`. A handoff that doesn't go out → the menu, and the row becomes `fallback`. A row this run already claimed is re-marked, not claimed twice.
- **AC-F8: pass.** `decideBookingRequest` returns `delivered: null` for a declined change request (no message by design). The route passes it through. The hook maps `null` to no notice, and `showsUndelivered` (badge) is true only for `delivered === false`. BOOK-001/BOOK-003 decline is unchanged: the message is sent; a failed one is `false` + `not_delivered`.
- **AC-F9: pass.** The cancel text = `withDisclosure(cancelledText(b), tenant disclosureText)`. `disclosureText` reaches the tool context from the agent config.
- **AC-F10: pass.** "Upcoming" = a later date, or today at the Hong Kong HH:MM now or later.
  - Applied in `listUpcoming` (one PostgREST `or`) and `cancelByDiner` (a nested `and(or(id…),or(upcoming))` in the same UPDATE). The change source and the cancel target both come from `listUpcoming`.
  - The port takes `from: {date, time}` (`HongKongMoment`); `hkNow()` builds it.
  - Tested: a booking for today 12:00 seen at 21:00 HK is not listed, not changeable and not cancellable, and the store's UPDATE refuses it. A booking that passed between propose and confirm is not cancelled.
  - Real PostgREST on the local stack: both filters parse and run (0-row probe, `fix1/f10-postgrest-syntax.log`).
- **AC-GATE: pass.** `resource-lock.py heavy -- bash -c 'npx tsc --noEmit && npx vitest run'` exit 0: 647 files passed (13 skipped), 7342 tests passed, 93 skipped, 2 todo (`fix1/gate.log`). Each `-t AC-Fn` filter passes (`fix1/ac-checks.log`). ESLint `--quiet` on the touched src files exits 0. No test removed (no `it`/`describe` line deleted in the diff). Assertions changed only where a fix changed behaviour:
  - The AC-VO default `enabledTools` now expects 3 tools (F4).
  - The worker booking tests tick all tools (`ALL_TOOLS`), as an owner would (F4).
  - Tool-level harnesses pass `agentMode`, `proposalOwner` and `disclosureText`, and mark the previous job's proposal delivered (`deliverAll`) before the next job, standing in for the worker's send (F1).
  - The listUpcoming query string now has the time (F10). The repository source check expects `.or(upcomingFilter(from))` (F10).
  - The R24 cancel text expects the disclosure (F9).
  - The R23 decline expects `delivered: null` (F8).
  - The Redis tests save with an owner and mark confirmable (F1).
  - The psql mirror of `cancelDinerBooking` has the time condition (F10).
- **AC-PR:** see the PR body; the push is verified by remote SHA = HEAD.

## decisions
- **F1 flag location:** Redis hash fields `owner` (run UUID) and `ok` ('1' = confirmable) on the existing proposal key. Mark and discard are owner-checked Lua scripts. Not a separate key, so one DEL still clears everything.
- **F1 duplicate run (BullMQ stall re-run):** because the owner is per run rather than per job, a re-run that overwrites the proposal and then loses the claim deletes it. The diner's "yes" then gets `no_proposal`, and the model proposes again. Safe direction.
- **F8 shape:** `delivered: boolean | null`, where null means no message by design. No extra `notified` field.
- **F7, a row already claimed by this run** (e.g. a throw after the claim): its outcome is re-marked `handoff`. It keeps the text it was claimed with. Only reachable if a dependency throws between the claim and the send.

## unverified
- **The AC-F10 real-DB block** (`agent-booking-changes.db.test.ts`, gated `RUN_DB_TESTS=1` plus a local `NEXT_PUBLIC_SUPABASE_URL`) and the updated psql mirror were NOT run. The `supabase-whatsapp-crm` lock is held by the r1–r3 stack keeper (PID 60682, `scratchpad/a3/tools/stack.sh`), which releases it only by stopping the stack. The brief forbids that, so I stopped my waiter instead. Substitute: the 0-row PostgREST probe above shows the filters parse and run. Semantics are covered by the fake and the unit tests. To run it, take the lock once the BOOK-004 peer is done.
- **No real-Gemini walk** of the full F1 flow; covered by the worker tests.

## review_focus
- `src/application/agent/process-agent-reply.ts`: `deliverProposal` / `discardProposal` (the `finally`), `respondToJobError`, shadow `deliverProposal`.
- `src/infrastructure/redis/agent-proposal-store.ts`: the TAKE (`ok` check after not-earlier), MARK and DISCARD scripts.
- `src/infrastructure/supabase/repositories/booking-request-repository.ts`: `upcomingFilter` and the nested cancel `or`.

## scope_drift
- `.claude-workspace/reviews/2026-11-19-agent-003-code-review.md` is copied from the main checkout as briefed.
- Nothing outside `files_allowed`. CLAUDE.md was not touched.
