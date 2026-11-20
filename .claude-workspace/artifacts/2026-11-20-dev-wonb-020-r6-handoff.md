---
id: artifacts/2026-11-20-dev-wonb-020-r6-handoff
type: handoff
contract: handoff-file-v1
author: dev
created: 2026-11-20
status: active
supersedes: artifacts/2026-11-20-dev-wonb-020-r4-handoff
superseded_by: null
item: WONB-020
round: r6
stage: POC
state: done
brief: inline (WONB-020 r6, final /code-review findings J1-J4)
base: f60315c0
head: "9d54eafe (code + tests + testid registry) -> one docs commit (kanban, poc-log, this file, r4 superseded); its SHA is the branch head, see ls-remote in the dev return block"
branch: feature/wonb-020-imported-welcome-claim
pushed: true
gate: {result: pass, at: "2026-11-20", note: "heavy lock, once: vitest 689 files / 7899 tests passed (15 files / 129 skipped, 2 todo), exit 0; tsc --noEmit 0 bytes, exit 0; eslint on the 12 touched .ts/.tsx files: no issues"}
next: {owner: main, action: "re-review r6 on PR #212 if wanted, then merge into develop and release (089 + 090 before the code, unchanged)"}
blockers: []
refs: ["https://github.com/xavierau/omc/pull/212", "kanban:WONB-020"]
---
ac:
  AC-1: "pass: red first (scratchpad r6-ac1-red.log: 2 failed / 8 passed: the mint test's createCampaignCoupon assertion now expects { welcomeOffer: true }, and the new process-welcome-send-job-welcome-offer.test.ts campaign case saw welcomeOffer false; its fallback case already passed, confirming createWelcomeCoupon marks itself). Green: mint-welcome-coupon-idempotent + process-welcome-send-job-welcome-offer + process-welcome-send-job 32/32. The new file runs processWelcomeSendJob with the REAL mint and coupon factory and asserts the createCoupon insert carries welcomeOffer: true on both legs (type promo + campaignId camp-1; type welcome)"
  AC-2: "pass: red first (r6-ac2-red.log after the lock helper existed: 7 failed / 43 passed; the 5 J2 cases and 2 J3 cases). Green `npx vitest run src/application/__tests__/register-member.test.ts` 50/50. Cases: held -> waitForWelcomeClaimLock lease -> join event on file -> no mint, no join event, no text/image send, lease released; held -> lease -> welcome coupon on file -> same; held -> lease -> not welcomed -> createWelcomeCoupon once, join event, QR image, wait before mint, release after the last send, the r4 lease untouched; held -> wait returns null -> exactly one text send (minimal 'Welcome to our loyalty program'), no mint, no join event, warning 'still held'; held -> lease -> hasJoinEvent throws -> minimal welcome, no mint, lease released. Race branch (createOrGetMember 23505 -> outcome existing): no join event/coupon -> tryAcquireWelcomeClaimLock(m-race), one coupon, join event, released, attemptWelcomeClaimLock never called; join event on file -> welcome-back, no coupon, no lock"
  AC-3: "pass: red first (r6-ac3-red.log: 5 failed / 18 passed). Green `npx vitest run src/application/__tests__/register-member-web.test.ts` 23/23. Held -> lease -> join event or welcome coupon on file -> {isNew:false, memberId, whatsappClaimUrl}, no mint, no join event, released; not welcomed -> minted once + join event under the lease (wait before mint, join event before release); wait returns null -> existing answer, no mint, warning 'still held'; lookup throws -> existing answer, no mint, released"
  AC-4: "pass: red first (r6-ac4-red.log: 2 failed / 7 passed); green `npx vitest run src/app/join/[slug]/__tests__/join-form.test.tsx` 9/9: the already_member and fields_required notices render data-testid=\"join-error\", the claim notice does not; join-claim-whatsapp ids unchanged. Registry row added under the WONB-020 join rows (.claude-workspace/ui-map/testid-registry.md line 119)"
  AC-5: "pass: `python3 ~/.claude/bin/resource-lock.py heavy -- sh -c 'npx vitest run; npx tsc --noEmit'` once after the touched-file loop: Test Files 689 passed | 15 skipped (704), Tests 7899 passed | 129 skipped | 2 todo; tsc output 0 bytes. eslint on every touched file: no issues"
  AC-6: "pass: see the dev return block for ls-remote == HEAD and gh pr view 212 mergeable; origin/develop unchanged since the r5 merge (89160ef5 is an ancestor of HEAD), so no merge was needed. PR body updated (r5 + r6 review bullets, new-member r6 sub-bullets, welcome_offer now on the partner mint, join-error, r6 test plan, the partner-mint known gap removed and the held-wait latency gap added). r4 handoff superseded_by this file"
decisions:
  - "Wait helper: waitForWelcomeClaimLock(restaurantId, memberId, {intervalMs=250, timeoutMs=5000}) in welcome-claim-lock.ts. It sleeps first (the caller already saw held), retries attemptWelcomeClaimLock, and stops when the next sleep would pass the deadline: 20 retries, settles at 5.0 s under fake timers. Each retry is bounded by the client's 2 s commandTimeout, so the worst case with a slow Redis is a little above 5 s, still bounded"
  - "Redis error DURING the wait -> null (treated as still held), not fail-open. A claim held the lock a moment earlier, so onboarding without the lock risks the double mint the lock exists to stop. The first-attempt 'unavailable' keeps the r4 fail-open, as the brief says"
  - "Shared lookup: isAlreadyWelcomed(restaurantId, memberId) in has-join-event.ts = hasJoinEvent || hasWelcomeCoupon, throwing on error. canClaimWelcome is now !isAlreadyWelcomed inside its existing try/catch, so its contract (error -> not claimable, same warning) is unchanged"
  - "register-member.ts: the new-member tail split into onboardCreatedMember (onboard; on throw the minimal welcome, as before), welcomeAfterConcurrentClaim (J2) and sendMinimalWelcomeOnly; the onboarding context reuses the exported OnboardContext type. J3 extracts respondToExistingMember (canClaimWelcome -> claimWelcomeUnderLock, else welcome-back), used by the pre-check and the race branch"
  - "J1 test: a new file runs processWelcomeSendJob with the real mint and coupon factory (coupon-repository faked by factory mock), because process-welcome-send-job.test.ts automocks the mint module for its whole file"
  - "Superseded tests: r4's two 'lock held -> no mint/sends' cases (WhatsApp and web) asserted the behaviour J2 replaces; they were replaced by the J2 cases above, not weakened"
failed: []
invariants:
  - "At most one welcome coupon per member: every mint on the new-member paths runs under the lock or with Redis down (r4 fail-open); the waited path mints only after re-checking join event + welcome coupon under the lock"
  - "Web never mints for an existing member: pre-check and race branches unchanged; the waited path mints only for the member this request created, after the not-welcomed check"
  - "Claim recovery still tells the member a minted code (r2 G1 tests unchanged, green)"
  - "Import, decideWelcome, campaign executor, welcome-back copy untouched; migrations 089/090 unchanged"
unverified:
  - "A real Redis race between a claim JOIN and a brand-new member's onboarding (unit-tested with mocks; the r1 real-Redis test covers SET NX semantics only)"
  - "WhatsApp JOIN on a real number (carried from r2-r4)"
  - "join-error not walked in a browser (render tests only)"
review_focus:
  - "src/application/register-member.ts createNewMember / welcomeAfterConcurrentClaim / respondToExistingMember"
  - "src/application/register-member-web.ts welcomeAfterConcurrentClaim"
  - "src/infrastructure/redis/welcome-claim-lock.ts waitForWelcomeClaimLock"
  - "src/application/has-join-event.ts isAlreadyWelcomed"
scope_drift:
  - "INDEX.md / active/artifacts.md / handoffs.md not updated: outside files_allowed"
fyi:
  - "Evidence (not committed): /private/tmp/claude-501/-Users-xavierau-Code-js-whatsapp-crm/29e1d11b-4cdc-46e6-8954-17896bb1b088/scratchpad/ r6-ac1-red.log, r6-ac2-red.log, r6-ac3-red.log, r6-ac4-red.log, r6-ac5-vitest.log, r6-ac5-tsc.log, pr212-r6-before.md, pr212-r6-body.md"
next_step: "Main: optional re-review of r6, then merge PR #212 into develop and release (deploy.sh applies 089 + 090 before the restart); the owner scans the join QR as an imported member on prod."
