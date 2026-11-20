---
id: artifacts/2026-11-20-dev-wonb-020-r1-handoff
type: handoff
contract: handoff-file-v1
author: dev
created: 2026-11-20
status: active
supersedes: artifacts/2026-11-20-dev-wonb-020-handoff
item: WONB-020
round: r1
stage: POC
state: done
brief: inline (WONB-020 r1)
base: cc05b60ffe420dac062d797616760cee57bbe58c
head: e90a80fb (code); docs commit follows on the same branch
branch: feature/wonb-020-imported-welcome-claim
pushed: true
gate: {result: pass, at: "2026-11-20T05:45Z", note: "vitest + tsc green; repo-wide eslint has 36 pre-existing errors, none in touched files"}
next: {owner: main, action: "re-review PR #212 (r1 diff e90a80fb), then merge into develop and release"}
blockers: []
refs: ["https://github.com/xavierau/omc/pull/212", "kanban:WONB-020"]
---
ac:
  AC-1: "pass (red first): register-member-web.test.ts 'WONB-020 r1 F1' x7 + route.test.ts. Claimable existing member -> {isNew:false, memberId, whatsappClaimUrl}; route -> {existing:true, claimOnWhatsApp:true, whatsappClaimUrl}; zero coupon/campaign-counter/join-event calls, also on a second submit; already welcomed or holding a welcome coupon -> {existing:true}; no usable number (null or '12') -> {existing:true}; new member unchanged ({couponCode})"
  AC-2: "pass (red first): src/app/join/[slug]/__tests__/join-form.test.tsx, 5 tests. Claim flag -> join.claimOnWhatsApp text and a link to https://wa.me/<n>?text=JOIN (testids join-claim-whatsapp, join-claim-whatsapp-link); no flag -> join.alreadyMember and no link; a non-wa.me URL is refused; en and zh-HK keys present"
  AC-3: "pass (red first): has-join-event.test.ts, 9 tests. A type welcome coupon, or a coupon of the current welcome campaign (or filter type.eq.welcome,campaign_id.eq.<id>), with no join event -> not claimable; a coupon lookup error or settings error -> not claimable, warns"
  AC-4: "pass (red first): register-member.test.ts 'r1 F3' x4. Lock not acquired -> welcome-back, no mint, no release; Redis error -> welcome-back (the helper resolves null, welcome-claim-lock.test.ts); claimability re-checked after the lock (2nd hasJoinEvent call after tryAcquire); lease released after the claim. Only the holder releases: Lua GET==token then DEL (unit) and real Redis (welcome-claim-lock.redis.test.ts, 2/2 on a throwaway redis-server :6491, RUN_REDIS_TESTS=1)"
  AC-5: "pass (red first): register-member.test.ts 'r1 F4' x4. Mint failure -> sendReturningWelcome text with the member's points (120), no minimal welcome; join-event write failure -> welcome-back; a send failure -> no minimal welcome; new-member mint failure -> minimal welcome text (unchanged)"
  AC-6: "pass (red first): process-member-create-job.test.ts 'WONB-020 F5' x4. createdByThisJob + no join event -> one join event; + existing join event -> none; pre-existing member -> none and no lookup; first-attempt create -> one, no lookup"
  AC-7: "pass: register-member.test.ts 35/35 and register-member-web.test.ts 14/14 alone; both together with --sequence.shuffle at seeds 1, 7, 42, 1234, 99999: 49/49 each. emitEvent/hasJoinEvent are mockReset in beforeEach; web no longer needs a stateful fake"
  AC-8: "pass with a note: heavy lock, once: vitest 667 files / 7632 tests passed (15 files / 129 skipped) exit 0; tsc --noEmit failed once on a test-only type error (join-form.test.tsx), fixed, re-run exit 0; eslint src exit 1 with 36 errors / 13 warnings, all in files this diff does not touch (no change to those files or the eslint config, so they fail the same way at base); eslint on all 18 touched files clean. No flaky webhook failures this run"
  AC-9: "pass: local next dev :3207 against DEV (ref ooknbeig…, not prod), restaurant omc-kitchen. Seeded member (no join event, no coupon). Web POST x2 -> 200 {existing:true, claimOnWhatsApp:true, whatsappClaimUrl:'https://wa.me/••••7267?text=JOIN'}; after: coupons 0, events 0. Headless Chromium submitted the real form at 1440x900 and 390x844: notice + link render, href matches ^https://wa.me/\\d+\\?text=JOIN$, overflow 0px, 0 console errors. Cleanup: deleted the one probe member only. Evidence (scratchpad): ac9-evidence/browser.json, claim-*.jpg"
  AC-10: "pass: pushed to origin/feature/wonb-020-imported-welcome-claim (ls-remote == HEAD), PR #212 body updated, kanban WONB-020 updated, this handoff written"
decisions:
  - "Coupon check is hasWelcomeCoupon() in coupon-repository.ts (one query, .or filter, limit 1, throws on error); canClaimWelcome() in has-join-event.ts loads welcomeCampaignId from getOnboardingSettings and fails toward not claimable on any error"
  - "Lock: src/infrastructure/redis/welcome-claim-lock.ts. Key wonb020:welcome-claim:<restaurant>:<member>, TTL 30 s, random UUID token, owner-checked Lua release. Its own lazy ioredis client (parseRedisUrl(redisUrl()), maxRetriesPerRequest 1, connectTimeout 5 s, commandTimeout 2 s). tryAcquireWelcomeClaimLock never throws: a Redis error logs a warning and reads as not acquired; release errors are swallowed (the TTL frees the key)"
  - "Claimability is checked before the lock (so normal returning members never touch Redis) and again under it"
  - "The web path resolves the WhatsApp number in the use case (getRestaurantEmailContext, read-only reuse, degrade-safe) and builds the link with the existing domain buildContactUrl(number, 'JOIN'), the same link shape as generate-qr.ts. The route only maps whatsappClaimUrl to {existing, claimOnWhatsApp, whatsappClaimUrl}"
  - "register-member-web.ts went back to base plus respondToExistingWebMember (the r0 mintWelcome extraction is gone, since only new members mint). register-member.ts new-member block is back to base byte-for-byte (r0's runOnboarding extraction removed, so the new-member minimal-welcome fallback is literally unchanged)"
  - "Form: exported claimUrlFrom() (accepts only https://wa.me/ URLs) and JoinFormNotice (claim block or the existing error line); anchor styled like BookingUnavailable's WhatsApp button"
failed: []
invariants:
  - "The web join form never mints a coupon or writes a join event for an existing member"
  - "WhatsApp: at most one claim at a time per (restaurant, member); no lock, a lookup error or a claim error -> welcome-back, never a coupon"
  - "A member with a join event or a welcome coupon is never claimable"
  - "The join event is written only after the coupon is minted (onboardNewMember, unchanged)"
  - "New-member paths (WhatsApp and web), import, decideWelcome, the campaign executor and the welcome-back copy are unchanged"
unverified:
  - "WhatsApp JOIN claim on a real number (no Kapso locally; unit tests only), and the lock against prod Redis. The Next app already uses REDIS_URL in the request path (integration-inbound rate limiter), and the code falls back to redis://localhost:6379, where prod Redis runs"
  - "English copy in a browser: the app's locale is process-wide (NEXT_PUBLIC_DEFAULT_LOCALE, default zh-HK), so the browser pass showed zh-HK only; the en key is checked by the unit test"
  - "PR CI result at handoff"
review_focus:
  - "src/application/register-member.ts claimWelcomeUnderLock / claimWelcomeForExisting"
  - "src/infrastructure/redis/welcome-claim-lock.ts (client options for a request path, never-throw wrapper)"
  - "src/infrastructure/supabase/repositories/coupon-repository.ts hasWelcomeCoupon .or filter (campaign id comes from our own DB)"
  - "src/app/join/[slug]/join-form.tsx: claim button and submit button are both full-width primary; the user could tap Join again (harmless, same answer)"
scope_drift:
  - "testid-registry (.claude-workspace/ui-map/testid-registry.md) not updated with join-claim-whatsapp / join-claim-whatsapp-link: outside files_allowed"
  - "INDEX.md / active/artifacts.md not updated: outside files_allowed"
  - "next dev regenerated CLAUDE.md again; restored from a copy, not committed"
  - "Tests added at src/app/join/[slug]/__tests__/ and src/infrastructure/redis/__tests__/ (both inside files_allowed globs)"
  - "Lock helper implementation was written alongside its unit tests, not strictly before them; the use-case tests for AC-4 were red first"
fyi:
  - "F6 (no index for the events join lookup) not fixed, as briefed"
  - "git merge-tree HEAD origin/develop (9f8c7d22, BOOK-007): code, kanban and messages merge clean; .claude-workspace/poc-log.md conflicts (both sides appended lines; keep both)"
  - "DEV members table has no loyalty_token column (DEV behind on migrations); the probe was seeded without it"
next_step: "Re-review the r1 diff on PR #212, resolve the poc-log append conflict when merging into develop, release, then have the owner scan the join QR as an imported member on prod (WhatsApp JOIN should claim once; the web form should show the WhatsApp link)."
