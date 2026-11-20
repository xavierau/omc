---
id: reviews/2026-11-20-wonb-020-r6-re-review
type: review
author: verifier
mode: re-review
created: 2026-11-20
status: active
supersedes: null
superseded_by: null
related: [artifacts/2026-11-20-dev-wonb-020-r6-handoff, artifacts/2026-11-20-dev-wonb-020-r4-handoff, kanban:WONB-020]
---
# Code Review: WONB-020 r6 (PR #212, f60315c0..b87d45c8): final-review fixes J1–J4

## Summary
All four findings are fixed at b87d45c8. I found no new path in the range that can mint a second welcome coupon, mint without the lock in the held branch, or leave a new member un-welcomed indefinitely. The webhook wait is bounded, but its worst case is about 7 s, not 5 s (N1, non-blocking). The range holds only J1–J4 code and tests, plus records (kanban, poc-log, r4/r6 handoffs, the testid registry), so `escalate_if` did not trigger. No prior verifier review of WONB-020 exists in `reviews/` (the J findings came from a `/code-review` run), so this review supersedes nothing.

| AC | Result | Evidence |
|---|---|---|
| AC-1 | J1–J4 all fixed | table below |
| AC-2 | No blocking path found; 4 non-blocking notes | Analysis below |
| AC-3 | green at b87d45c8 | `npx vitest run` on the 4 brief files plus `process-welcome-send-job-welcome-offer.test.ts` and `welcome-claim-lock.test.ts`: 6 files, 104/104 passed, worktree clean, HEAD = b87d45c8 |

### J1–J4

| # | Verdict | Evidence |
|---|---|---|
| J1: partner welcome mint writes `welcome_offer` | FIXED | `src/application/mint-welcome-coupon-idempotent.ts:54` passes `{ welcomeOffer: true }` to `createCampaignCoupon`. `coupon-factory.ts:59,92` forwards it to `createCoupon` → `coupon-repository.ts:31` writes `welcome_offer: true`. The fallback leg `createWelcomeCoupon` already marks itself (`coupon-factory.ts:33`). The new test `process-welcome-send-job-welcome-offer.test.ts` runs the real mint and factory and checks both legs. |
| J2: held lock → wait ≤~5 s, re-check, onboard once, or fall back | FIXED | WhatsApp: `register-member.ts:272` sends held → `welcomeAfterConcurrentClaim` (301–318). No lease → minimal no-code welcome (303–305). Lookup error → minimal welcome (308–312). Already welcomed → no send, no mint (313). Not welcomed → `onboardCreatedMember` under the waited lease, released in `finally` (314–317). Web: `register-member-web.ts:114` → 129–149. Only `welcomed === false` mints (144); everything else gets the existing-member answer. Wait helper: `welcome-claim-lock.ts:122–135`, 250 ms × 20. A Redis error during the wait → null (fail closed). `isAlreadyWelcomed` (`has-join-event.ts:33–36`) throws on a lookup error, and `canClaimWelcome` still catches it, so that contract is unchanged. |
| J3: createOrGetMember race branch → `canClaimWelcome` → `claimWelcomeUnderLock` | FIXED | `register-member.ts:250` now calls `respondToExistingMember` (89–100), the same gate the pre-check uses (59). The claim re-checks under `tryAcquireWelcomeClaimLock` (131–137). |
| J4: `data-testid="join-error"` + registry row | FIXED | `src/app/join/[slug]/join-form.tsx:144`. Registry row at `.claude-workspace/ui-map/testid-registry.md:119`. The render test asserts the testid is on the error notice and absent from the claim notice. |

### AC-2 analysis (concurrent paths traced)
- **Creator A (new member) vs. claim B (a JOIN that sees A's row through the pre-check or the J3 race branch).** Every mint runs under the per-member lock, and every lock holder re-checks before minting: B in `claimWelcomeUnderLock:134`, A's waited path in `isAlreadyWelcomed` at 308. A's first-attempt path needs no re-check because the member row is brand new and B cannot mint without the lock. The join event and coupon are written inside the holder's lock window (`onboard-new-member.ts` mints, then emits `join`, then sends, all before the `finally` release), so the next holder's re-check sees them. Result: one mint.
- **Holder fails after the mint** (coupon on file, no join event). `hasWelcomeCoupon` matches `type welcome OR welcome_offer` (`coupon-repository.ts:133`), so the next holder sees "welcomed" and does not mint.
- **Holder fails before the mint.** The next holder sees "not welcomed" and onboards, so the member is still welcomed.
- **Never welcomed indefinitely.** On WhatsApp, a lock still held or a failed lookup sends the no-code minimal welcome and writes no join event or coupon, so the member can still claim with a later JOIN. On the web, the answer carries the wa.me JOIN link. A held lock implies a concurrent WhatsApp claim, so a usable number exists.
- **No mint without the lock in the held branch.** Both waited paths mint only after `waitForWelcomeClaimLock` returns a lease. An `unavailable` result during the wait returns null instead of failing open.

## 🔴 Critical (Must Fix)
None.

## 🟡 Important (Should Fix)
None.

## 🟢 Minor (Optional, non-blocking)
- **N1: the webhook wait can run past 5 s.** `welcome-claim-lock.ts:128–132`: the loop checks the deadline before each 250 ms sleep, but each `attemptWelcomeClaimLock` can take up to the client's 2 s `commandTimeout` (line 56). The worst case is about 7 s before onboarding starts, followed by the welcome sends, all inside the synchronous JOIN webhook (`join-and-image-handlers.ts:57`). Why non-blocking: the wait stays bounded, a timed-out attempt ends it at once (unavailable → null), and the dev's handoff discloses it. To show it: inject a `set` that resolves "held" after 1.9 s; the wait returns after about 6.9 s.
- **N2: a claim that takes longer than the wait gives the member two welcome messages.** If B's sends take over 5 s, A sends the no-code minimal welcome while B sends the full welcome with its code. Only one coupon is minted. Why non-blocking: no money is at stake, only an extra message. The PR body lists it as the held-wait latency gap.
- **N3: the web waited path answers "already a member" to the person who just created the member.** `register-member-web.ts:145`, when the concurrent WhatsApp claim already welcomed them. The answer is correct: they hold a welcome on WhatsApp and the link points there.
- **N4: the J3 race branch inherits r4's Redis fail-open.** If Redis fails on A's first attempt and recovers for B, both can mint. The pre-check path already had this exposure in r4. Not a new class of risk, and r4 design is out of scope per the brief.

## ✅ Strengths
- The shared `isAlreadyWelcomed`, which throws on error, lets the waited path tell "welcomed" from "could not check" without changing `canClaimWelcome`'s fail-closed contract.
- The tests pin the call order: wait before mint, last send before the lease release, and the r4 lease untouched on the waited path.
- Failing closed on a Redis error during the wait is the right asymmetry against r4's fail-open on the first attempt, because a claim was in flight a moment earlier.

## Open Questions
- Unchanged from the dev's `unverified` list: there is no real-Redis race test between a claim and a brand-new member's onboarding, no WhatsApp JOIN on a real number, and `join-error` was not walked in a browser.

## Verdict: APPROVED

## Next Steps
- The main thread can merge PR #212 into develop and release with migrations 089 and 090 applied before the code, as already planned. N1 and N2 can go to a later item if wanted.
