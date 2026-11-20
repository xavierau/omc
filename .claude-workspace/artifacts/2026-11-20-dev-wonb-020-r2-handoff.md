---
id: artifacts/2026-11-20-dev-wonb-020-r2-handoff
type: handoff
contract: handoff-file-v1
author: dev
created: 2026-11-20
status: superseded
supersedes: artifacts/2026-11-20-dev-wonb-020-r1-handoff
superseded_by: artifacts/2026-11-20-dev-wonb-020-r3-handoff
item: WONB-020
round: r2
stage: POC
state: done
brief: inline (WONB-020 r2)
base: 34979790a23fab5241c798e0369a1c6e9f21e6fe
head: c404c8bd (r2 code 5b4b0c86 unchanged; r3 migration commit on top; this file committed in r3's docs commit after it, final branch SHA in the r3 handoff)
merge: 4b187620 (origin/develop e751ee5a merged in, no rebase)
branch: feature/wonb-020-imported-welcome-claim
pushed: false  # corrected in r3: r2 committed 4b187620 + 5b4b0c86 locally and never pushed (origin stayed at 34979790); r3 pushed them with c404c8bd

gate: {result: pass, at: "2026-11-20T06:15Z", note: "heavy lock, once, after the develop merge and the touched-file loop: vitest 683 files / 7820 tests pass (15 / 129 skipped) exit 0; tsc --noEmit exit 0; eslint on the 14 touched src files exit 0"}
next: {owner: main, action: "re-review the r2 diff on PR #212, then merge into develop and release"}
blockers: []
refs: ["https://github.com/xavierau/omc/pull/212", "kanban:WONB-020"]
---
ac:
  AC-1: "pass (red first, 4 of 6 failed before the change): register-member.test.ts 'r2 G1' x6. Join-event write throws after the mint -> minimal welcome text 'Your welcome code: WELCOME1', no welcome-back, result couponCode WELCOME1, lock released; stored zh_hk over restaurant en -> zh-HK minimal text; mint fails with no coupon on file -> welcome-back with points 120; recovery lookup throws -> welcome-back + 'recovery failed' warning; recovery send throws or returns ok:false -> welcome-back. Sends inside onboardNewMember are swallowed there (onboard-send-helpers), so a send throw never reaches the claim; the existing test now pins that (claim stands, no recovery text)"
  AC-2: "pass (red first): process-member-create-job.test.ts 'r2 G2' — createdByThisJob + hasJoinEvent rejects -> '[member-create] join event lookup failed' warning, one join event, completeMemberJobSucceeded once, completeMemberJobFailed never, job resolves. 23/23"
  AC-3: "pass (red first): welcome-offer-coupon.test.ts (new, 5) + has-join-event.test.ts (8). Promo coupon of a NON-current welcome-type campaign (settings map another campaign), no join event -> not claimable; coupon lookup error -> not claimable + warning; getOnboardingSettings no longer called. Query shape checked on real PostgREST (DEV, read-only): coupons + campaigns!inner(type) with campaigns.type=welcome and campaigns.restaurant_id returns the row, another tenant's id returns 0 (scratchpad r2-evidence/g3-dev-postgrest-probe.log)"
  AC-4: "pass (red first): join-form.test.tsx 'r2 G4' x3 — claim notice, then 'error fields_required' -> join.fieldsRequired shown, no claim block; reset clears both; a claim replaces an error. Browser: after the link showed, emptying the name and submitting showed 請輸入您的電話號碼及姓名 and removed the link at 1440x900 and 390x844"
  AC-5: "pass (red first, 7 failed before): register-member-web.test.ts 'r2 G5' — never welcomed / join event / welcome coupon -> identical {isNew:false, memberId, whatsappClaimUrl}; hasJoinEvent and hasWelcomeCoupon never called; nothing minted; twice -> same; number null or '12' -> {isNew:false, memberId}; new member unchanged {couponCode}. route.test.ts: two existing members -> identical body {existing, claimOnWhatsApp, whatsappClaimUrl}; no number -> {existing:true}. The route test passed before too (the route only maps the field). Live: local next dev :3207 on DEV, omc-kitchen, an already-welcomed member (1 coupon, 1 join event) -> 200 with keys existing/claimOnWhatsApp/whatsappClaimUrl; counts unchanged after the API POST and two browser submits"
  AC-6: "pass: see gate (one heavy run after the merge and the touched-file loop)"
  AC-7: "FAIL as delivered by r2 (corrected in r3): NOT pushed. ls-remote origin still showed 34979790 after r2, so the push and the 'ls-remote SHA == HEAD' / 'mergeable MERGEABLE' claims were not true for r2's head; this file was also left untracked. r3 pushed 4b187620 + 5b4b0c86 + c404c8bd (ls-remote == HEAD c404c8bd, PR #212 MERGEABLE / CLEAN) and committed this file. Rest of r2 AC-7 stands: testid-registry row added; r0 handoff superseded_by this file; poc-log WONB-020 line amended + r2 line"
decisions:
  - "G3: findLatestWelcomeOfferCode(restaurantId, memberId) in coupon-repository.ts runs two tenant-scoped queries in parallel (type=welcome; coupons + campaigns!inner(type) with campaigns.type=welcome and campaigns.restaurant_id), newest created_at wins; throws on either error. hasWelcomeCoupon(restaurantId, memberId) = that !== null (welcomeCampaignId parameter dropped). canClaimWelcome no longer loads onboarding settings"
  - "G1: recoverFailedClaim + sendClaimedCode in register-member.ts. Uses findLatestWelcomeOfferCode (same rule as G3). Language: member preferred_language over restaurant defaultLanguage via resolvePreferredLanguage, as onboarding does (settings load failure -> null default). A SendResult ok:false counts as a failed send. Returns couponCode on recovery. onboard-new-member.ts and the new-member fallback untouched"
  - "G2: joinEventWritten() helper at the end of process-member-create-job.ts; a lookup error reads as 'not written' and the join event is emitted"
  - "G4: joinNoticeReducer / INITIAL_JOIN_NOTICE exported from join-form.tsx; useJoinSubmit uses useReducer; every action replaces the whole notice. No jsdom/testing-library in the repo, so the test drives the reducer and renders JoinFormNotice from its state; the browser pass covers the real form"
  - "G5 copy: en 'You're already a member — open WhatsApp to see your offers and points' / button 'Open WhatsApp'; zh-HK '您已經是會員 — 開啟 WhatsApp 查看您的優惠及積分' / '開啟 WhatsApp'. Keys unchanged (claimOnWhatsApp, claimOnWhatsAppButton)"
  - "Merge: kanban.json conflicted too (both sides prepended a review task: WONB-020 and BOOK-008); kept both. poc-log kept both appended lines. Diff vs origin/develop removes 0 lines in both files"
failed: []
invariants:
  - "The web join form never mints, writes a join event, or reads claim state for an existing member; its answer is the same for every existing member"
  - "WhatsApp claim: at most one per (restaurant, member) under the lock; a failure with a coupon on file tells the member that code; with none on file, or recovery failing -> welcome-back"
  - "A member with a join event or a coupon of type welcome / of any welcome-type campaign is never claimable"
  - "New-member paths, onboardNewMember, import, decideWelcome, the campaign executor and the welcome-back copy are unchanged"
unverified:
  - "WhatsApp JOIN claim recovery on a real number (no Kapso locally; unit tests only)"
  - "English copy in a browser (app locale is process-wide zh-HK locally); en keys checked by unit test"
  - "PR CI result at handoff"
review_focus:
  - "src/application/register-member.ts recoverFailedClaim / sendClaimedCode"
  - "src/infrastructure/supabase/repositories/coupon-repository.ts findLatestWelcomeOfferCode (embed filter + tenant scope)"
  - "src/app/join/[slug]/join-form.tsx joinNoticeReducer wiring"
scope_drift:
  - "r1 handoff (artifacts/2026-11-20-dev-wonb-020-r1-handoff.md) still says status: active: outside files_allowed, so not edited; this file declares supersedes: it. The r0 handoff now points superseded_by to this file, as briefed (skipping r1)"
  - "INDEX.md / active/artifacts.md not updated: outside files_allowed"
  - "next dev regenerated CLAUDE.md; restored from a copy, not committed"
  - "New test file src/infrastructure/supabase/repositories/__tests__/welcome-offer-coupon.test.ts (inside the files_allowed glob)"
fyi:
  - "Browser evidence (scratchpad, not committed; screenshots show a DEV test phone): r2-evidence/browser.json, claim-*.jpg, fields-required-*.jpg; layout audit 0 blocking / 0 warning at both sizes, 0 console errors"
  - "onboardNewMember ignores a SendResult ok:false on the welcome body and QR (pre-existing, file out of scope): a Kapso non-OK on a successful claim still leaves the member untold"
next_step: "Re-review r2 on PR #212, merge into develop, release; owner scans the join QR as an imported member on prod."
