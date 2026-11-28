---
id: reviews/2026-11-19-agent-003-rereview
type: review
author: verifier
mode: re-review
created: 2026-11-19
status: active
supersedes: reviews/2026-11-19-agent-003-code-review
superseded_by: null
related: [artifacts/2026-11-19-agent-003-fix1-handoff, threats/2026-11-19-agent-003-agent-booking, kanban:AGENT-003, github:195]
range: c75d682c..8fa46bf2
tree: /Users/xavierau/Code/js/whatsapp-crm--agent-003
---

# Code Review: AGENT-003 fix round r4 re-review (PR #195 @ 8fa46bf2)

## Summary

All ten findings are CLOSED at 8fa46bf2, each implementing its fixed ruling. I checked the code at the tree, not the handoff's description of it. Touched-file vitest: 6 files, 185/185 pass (`agent-003-review-fixes`, `agent-booking-change`, `agent-booking-tools`, `agent-client`, `agent-config`, `booking-hooks`).

The fix round introduces one new **important** issue, N1, which is not release-blocking. On a job error for a `handoff` tenant, the new claim-before-send turns a failing row insert into **zero** responses; before the fix the diner got the handoff. I reproduced it with a scratch test. Two nits: N2 (F10's nested cancel filter now skips a same-day past change request) and N3 (shadow can get a change/cancel WAITING line it cannot act on).

Booking safety holds. No path lets a diner confirm a proposal whose read-back was not sent. Shadow cannot change or cancel. The Lua scripts are owner-checked, atomic and keep the TTL.

Verdict: **APPROVED**. No release-blocking item. N1 is recommended as a follow-up (or a one-line pre-release fix, main's call).

## Per-finding status (AC-1)

| ID | Status | Evidence (8fa46bf2) |
|---|---|---|
| F1 | CLOSED | `saveProposal` stores under the run's owner, without `ok` (`agent-booking-gate.ts:89-93`, `agent-proposal-store.ts:58-66`). `markConfirmable` runs only after `sendText` returned ok (`process-agent-reply.ts:408-411`) or in shadow after the draft claim succeeded (`:445-447`). A `finally` discards on every other end (`:511-514`): superseded or silenced `:431-435`, failure `:439-441`, window closed or no phone `:401-404`, claim lost `:406`, send failed `:415-416`, job error. `discard` is skipped once delivered (`:233-236`). TAKE returns none unless `ok == '1'` (`agent-proposal-store.ts:31`). `peekKind` needs `ok` too (`:79`), so the WAITING line only follows a sent read-back. The owner check covers BullMQ duplicate runs: the run that loses the claim always discards, and a run cannot mark a proposal another run overwrote. |
| F2 | CLOSED | `NOT_IN_SHADOW` (4 tools) is filtered in `bookingToolsForMode` (`agent-booking-tools.ts:60-77`). It applies to declarations, `offeredTools` and the executor gate (`agent-tools.ts:118`), and the worker passes the effective `mode` (`process-agent-reply.ts:321,333-334`). |
| F3 | CLOSED | `isOpenChangeRequest` = `replacesBookingId && status === 'pending'` (`booking-request.ts:129-131`). It is used in list (`agent-booking-change-tools.ts:127`), propose (`:152-153`) and confirm (`:173`). The cancel UPDATE already scopes change rows to `status.eq.pending` (`booking-request-repository.ts:333`). The dashboard's "change from" line (`booking-row.tsx:97`) is staff-facing history, not an open-request decision. |
| F4 | CLOSED | `DEFAULT_ENABLED_TOOLS` is the three read-only tools (`agent-config.ts:54,133`). A non-array resolves to it (`:163`) and a non-object blob to `DEFAULT_AGENT_CONFIG` (`:173`). The admin form seeds from the resolved config (`use-agent-settings.ts:53`), so a new tenant saves no booking tool. |
| F5 | CLOSED | `offersProposal` tests `PROPOSING_TOOLS` (all three `propose_*`) (`process-agent-reply.ts:336`; `agent-booking-tools.ts` `PROPOSING_TOOLS`). |
| F6 | CLOSED (per ruling) | The step is pushed verbatim (`agent-client.ts:314`), with the reason documented at `:29-36`. An AC-F6 unit test asserts the fallback request carries the signed step (`agent-client.test.ts`). The ruling stands; not reopened. |
| F7 | CLOSED | `respondToJobError` (`process-agent-reply.ts:200-218`) re-reads an unread config; still unreadable or `menu` → `fallback()`. For handoff it claims the `handoff` row before `sendHandoff` (`:211-216`). The claim is `taken` → return, so there is no double handoff. A send failure → menu, and the row becomes `fallback` or `error` (`:217`). See N1 for the claim-throws case. |
| F8 | CLOSED | A declined change request returns `delivered: null` (`decide-booking-request.ts:84`). The route passes it through (`decision-response.ts:32`). The hook keeps null (`use-bookings.ts:27-29`) and the badge needs `delivered === false` (`:120-122,133`). |
| F9 | CLOSED | Cancel text = `withDisclosure(cancelledText(target), booking.disclosureText)` (`agent-booking-change-tools.ts:243`). `disclosureText` comes from the agent config (`process-agent-reply.ts:303`). |
| F10 | CLOSED | `upcomingFilter` = `booking_date.gt.D,and(booking_date.eq.D,booking_time.gte.HH:MM)` (`booking-request-repository.ts:278-280`), used in list (`:290`) and nested in the cancel UPDATE (`:333`). It keeps `.eq('restaurant_id')`, `.eq('phone')` and `.in('status',[pending,confirmed])` (`:287-289,329-331`). `hkNow` is built from `hongKongToday`/`hongKongTime` (en-GB, h23, 2-digit → `HH:MM`) at confirm time (`agent-booking-gate.ts` `hkNow`, `agent-booking-change-tools.ts:238`). `booking_time` is `TIME` (`082_booking.sql:86`), so `gte.21:00` compares as a time. The values come from the app, never from model input. The handoff ran a PostgREST parse probe; the real-DB block did not run (handoff `unverified`). |

## 🔴 Critical (Must Fix)

None.

## 🟡 Important (Should Fix)

**N1. Job error + failing row insert → no response at all for a `handoff` tenant (regression from F7)**
- **Where:** `src/application/agent/process-agent-reply.ts:213` (`this.claim(...)` inside `respondToJobError`), caught at `:509`.
- **Problem:** if `recordModelRow` throws, the throw leaves `respondToJobError` before `sendHandoff` and `fallback()`. The outer `.catch(() => undefined)` swallows it. One way in: a job error that was itself a failing `recordModelRow` in `deliver`/`fallBack`/shadow claim, followed by the same insert failing again.
- **Risk:** the webhook suppressed the menu for an auto-admitted message, so the diner gets silence. At c75d682c, `respondToFailure` sent the handoff without a row (`git show c75d682c:…process-agent-reply.ts:174-177`). Menu tenants are unaffected because the menu path does not claim. This breaks "one response per auto message". It is not a booking-safety issue.
- **How it fails (reproduced):** use `workerHarness({ config: { mode: 'auto', failureAction: 'handoff' } })`, admit one inbound, then set `h.store.recordModelRow = async () => { throw new Error('insert failed') }` and run `processAgentReply`. It returns `'error'` with `h.sends.length === 0` and `h.fallbacks.length === 0`. Scratch test: `/private/tmp/claude-501/-Users-xavierau-Code-js-whatsapp-crm/b7ce2348-be88-463f-a29e-8e4b78a7d232/scratchpad/rr/claim-throw.test.ts`, output `sends 0 fallbacks 0`.
- **Fix:** wrap the claim. If it throws (as opposed to returning `taken`), send `fallback()`, the menu, which has no row on this path either, and return. A taken claim keeps returning without a send.
- **Why not release-blocking:** it needs agent_messages writes to be failing. In that state the agent records nothing anyway, and BullMQ will not retry (the job returns `'error'`). No booking, change or cancel is affected.

## 🟢 Minor (Optional)

**N2. F10's nested cancel filter leaves a same-day past change request pending**
- **Where:** `src/infrastructure/supabase/repositories/booking-request-repository.ts:333`.
- **Problem:** `upcomingFilter` is ANDed onto both the target and its open change rows. Example: booking B is tomorrow, its pending change request C is for today 12:00, and the diner cancels B at 21:00. B is cancelled, but C stays `pending`. Before F10 (date ≥ today), C was cancelled with B. The migration 085 RPC confirms a change without checking the original's status (`085_agent_booking_changes.sql:77-91`), so if staff later confirm C, the diner gets a confirmation for a booking they cancelled.
- **Fix:** apply the upcoming condition to the target only. The target was already resolved from `listUpcoming`. `or(and(id.eq.X,or(<upcoming>)),and(replaces_booking_id.eq.X,status.eq.pending))`.
- **How it fails:** seed B (tomorrow) and C (pending, today 12:00, `replaces_booking_id = B`), set the clock to 21:00 HK, then `confirm_booking_cancel` B. C stays pending.

**N3. Shadow can be told a change/cancel read-back is waiting**
- **Where:** `src/application/agent/process-agent-reply.ts:336-338`.
- **Problem:** after an auto → shadow switch within the 30-minute TTL, an auto-delivered change/cancel proposal is still confirmable. Shadow offers `propose_booking`, so `peekKind` runs and the model gets a `change`/`cancel` WAITING line for a tool it does not have. Nothing is sent or changed: the draft only, and the executor refuses. Harmless noise in the shadow draft.
- **Fix (optional):** pass `pending` only when its kind's confirm tool is in `offered`.

## ✅ Strengths

- **F1 owner model.** It closes the duplicate-run hole as well as the listed outcomes: a run that sent a read-back for P_A cannot mark P_B written by a concurrent duplicate. The loser of the claim always discards.
- **TAKE ordering.** The not-earlier check runs before the confirmable one, which keeps R15's `awaiting_diner_confirmation` for a same-job take.
- **MARK** uses HSET on the existing key, so the PEXPIRE stays. Owner-check and write run in one script, so they are atomic.
- **Redis or mark failures fail safe.** `deliverProposal` and `discardProposal` are caught. A mark failure leaves the proposal non-confirmable, so the diner's "yes" gets `no_proposal`.
- **F6** was settled by a live probe rather than speculation, and the decision is documented next to the code.

## Open Questions

- **Q1** (pre-existing, not a finding): `respondToJobError`'s menu branch sends without a claim, as `respondToFailure` did. A BullMQ duplicate whose twin already answered can therefore still send a second menu on a job error.
- **Q2** (ruled, not reopened): a shadow-stored create proposal is confirmable from the draft (F1 shadow ruling). A shadow → auto switch within 30 minutes then shows the auto run a WAITING line for a read-back the diner never received. This is inside OR5/OR6 as ruled; raise it with the owner if the switch is expected right after a shadow trial.
- **Q3:** "delivered" means the BSP accepted the send (sync ack), not the async delivery status. A send acked and later failed leaves the proposal confirmable. The diner would have to say "yes" to an unseen message, and OR6 (the model judges yes) covers it.
- **Q4:** the real-DB F10 block (`agent-booking-changes.db.test.ts`) did not run; only a PostgREST parse probe did. I did not run it either: the brief forbids the supabase lock.

## Verdict: APPROVED

Brief token: **APPROVED**. Release-blocking items: none. N1 (important) is recommended before or right after release; N2 and N3 are nits.

## Next Steps

1. Main decides on N1: a one-line pre-release fix through a cold `dev` brief, or a follow-up item.
2. Release per the fix1 handoff: migration 085 first, then the worker restart, then tick the booking tools for omc (F4 made them opt-in).
3. Run the F10 real-DB block once the supabase lock is free (Q4).
