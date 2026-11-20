---
id: artifacts/2026-11-20-dev-wonb-020-handoff
type: handoff
contract: handoff-file-v1
author: dev
created: 2026-11-20
status: active
item: WONB-020
state: done
brief: inline
base: 7bbe622f665b13f5940e6387d478224275bf4891
head: 425f28368465aee4f6bd13d73a524c1d751b47e9
branch: feature/wonb-020-imported-welcome-claim
pushed: true
gate: {result: pass, at: "2026-11-20T04:10Z"}
next: {owner: main, action: "review and merge PR #212 into develop, then release"}
blockers: []
refs: ["https://github.com/xavierau/omc/pull/212", "kanban:WONB-020"]
---
ac:
  AC-1: "pass — register-member.test.ts 'AC-1 …' x2: onboardNewMember once (coupon + welcome text + QR), no welcome-back, couponCode returned, stored name (fallback contactName) and stored language"
  AC-2: "pass — register-member.test.ts 'AC-2 …': welcome-back only, no coupon, no event"
  AC-3: "pass — register-member-web.test.ts AC-3 x3 + src/app/api/join/[slug]/__tests__/route.test.ts: coupon minted, then join event; {couponCode}; with a join event → {existing:true}. red_first: all three files failed before implementation"
  AC-4: "pass — stateful join-event fake on both paths: one coupon across two joins, second is welcome-back / {existing:true}"
  AC-5: "pass — lookup rejection mints nothing, gives welcome-back / {existing:true}, warns 'join-event lookup failed' (both paths + has-join-event.test.ts)"
  AC-6: "pass — heavy lock, once: vitest 665 files / 7602 tests passed (14 files / 127 skipped) exit 0; tsc --noEmit clean; eslint on the 9 touched files clean"
  AC-7: "pass — local next dev :3207 against DEV (omc-kitchen), seeded member with no join event: POST1 {couponCode:AH2XT3} 200 with 1 coupon + 1 join event in DB; POST2 {existing:true} 200; cleaned up only run-created rows (event, coupon, member; campaign non_chargeable_sent_count 1→0)"
  AC-8: "pass — PR #212 open into develop; kanban WONB-020 in review with PR link; poc-log line appended"
decisions:
  - "Lookup: hasJoinEvent() in event-repository.ts (restaurant + member + type join, limit 1, throws on error); canClaimWelcome() in application/has-join-event.ts holds the fail-toward-welcome-back policy"
  - "WhatsApp claim reuses onboardNewMember via the extracted runOnboarding (same minimal-welcome fallback); race path (23505) stays welcome-back to avoid double coupons"
  - "Web claim reuses the extracted mintWelcome (campaign or welcome coupon, then join event); route returns {couponCode} when isNew || couponCode"
  - "No claimed_existing tag: the WhatsApp join event is written in onboard-new-member.ts (outside files_allowed); a web-only tag would be inconsistent"
  - "No concurrency guard: a real one needs a partial unique index on join events, which is a migration outside files_allowed"
failed: []
invariants:
  - "A join event is written only after the coupon is minted, on both paths"
  - "A join-event lookup error never mints a coupon"
  - "Members with an existing join event keep the unchanged welcome-back / {existing:true}"
  - "Every creation path except import writes a join event (WhatsApp onboardNewMember, web mintWelcome, partner API process-member-create-job.ts:321 on created)"
unverified:
  - "WhatsApp JOIN for an imported member on a real number (no Kapso locally; unit tests only)"
  - "Concurrent double claim (form double-submit or two JOINs at once) can mint two coupons"
  - "Coupon minted but join event insert failed → next JOIN mints again (pre-existing for new members too)"
  - "PR CI: no checks reported on the branch at handoff"
review_focus:
  - "src/application/register-member.ts claimWelcomeForExisting / runOnboarding extraction"
  - "src/application/register-member-web.ts mintWelcome extraction and select('id, name')"
  - "Fail-safe direction in src/application/has-join-event.ts"
scope_drift:
  - "next dev rewrote CLAUDE.md (nextjs-agent-rules block); reverted, not committed"
  - "INDEX.md / active/artifacts.md not updated (outside files_allowed)"
  - "contract-check flags src/app/api/join/[slug]/route.ts as outside files_allowed; it is listed literally (glob reads [slug] as a char class)"
next_step: "Review and merge PR #212 into develop, release, then have the owner scan the join QR as an imported member on prod."
