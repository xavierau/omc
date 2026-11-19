---
id: artifacts/2026-11-19-dev-camp-016-r3-handoff
type: handoff
contract: handoff-file-v1
author: dev (camp-016 r3)
created: 2026-11-19
status: active
supersedes: artifacts/2026-11-19-dev-camp-016-r2-handoff
superseded_by: null
item: CAMP-016
state: done
brief: inline
base: 45d07224976c5c1b86c7296d1eb68981e6d54514
head: 16d4c9d8
branch: feature/camp-016-audience-quality
pushed: false
stage: poc
suite_changed: false
gate: {result: pass, at: "2026-11-19T16:00:00Z"}
next: {owner: main, action: "push feature/camp-016-audience-quality (agent pushes are denied for this public repo), then owner review of PR #200 and the go for releasing migration 086"}
blockers: []
refs: [artifacts/2026-11-19-camp-016-plan, artifacts/2026-11-19-settings-campaign-quality-ux, artifacts/2026-11-19-dev-camp-016-handoff, artifacts/2026-11-19-camp-016-r3-evidence]
---
fixes:
  F1: {commit: 84c65c71, what: "086 is_lapsed: never-visited member lapses only when joined_at < now() - lapsed days (legacy win-back still excludes never-visited); 086 edited in place"}
  F2: {commit: 650b6878, what: "saveAudienceDefaults UPDATEs; no row → re-seed {restaurant_id, monthly_send_limit: planCampaignQuota(plan)} with ON CONFLICT DO NOTHING, then UPDATE; missing restaurant → error"}
  F3: {commit: 84c65c71, what: "campaign_audience_members(…, p_limit, p_after_id uuid): keyset r.id > p_after_id ORDER BY id LIMIT; DROP FUNCTION IF EXISTS the first cut's (…, int, int) OFFSET signature; TS readAllPagesAfterId + fetchAudienceMembersPage(q, afterId, limit)"}
  F4: {commit: 37fbbe9f, what: "PATCH: an omitted filter keeps existing.audienceSkipQuality / audienceLapsedDays; body.type === 'winback' always re-snapshots (lapsed = saved or tenant default)"}
  F5: {commit: 37ec3431, what: "members empty state + dashboard Generate QR → settingsGroupHref('welcome'); sidebar item keeps /dashboard/setup (label 'Settings')"}
  F6: {commit: "7b2cebad + 16d4c9d8 (listing test)", what: "admin review size = countAudience(audienceQueryForCampaign(row, …)).willReceive; listing selects the snapshot columns; selected and broadcast 'all' now sized; welcome/birthday 'all' stays '—'; tag with no tags = 0"}
  F7: {commit: dbbed4e6, what: "isNonBroadcastAll (one BROADCAST_TYPES) shared by send and audience-count; birthday + all → NO_AUDIENCE_COUNTS without an RPC"}
  F8: {commit: a1c5b274, what: "GET /api/dashboard/receipts/flagged/count (select id, count exact, head true, restaurant_id + status flagged); pill refetches on a module-level signal fired by decideFlaggedReceipt from FlaggedReceiptsPanel"}
  F9: {commit: 32640c8a, what: "yellow copy '{yellow}% to under {green}% delivered' / '{yellow}% 至低於 {green}% 送達'; yellowMax removed; UX spec strings updated"}
ac:
  AC-1: {result: pass, evidence: "artifacts/2026-11-19-camp-016-r3-evidence/ac1-red.log: vitest on pre-fix 086 (22 failed) + direct psql on the pre-fix function: joined-2-days member is_lapsed=t; OFFSET walk with a page-1 rating flip → 'still included: 1599, never paged: 1'. ac1-green.log: 33/33 on a fresh 001..085 + fixed 086 (new: NEW excluded / Y2 included at lapsed 30, keyset flip loses nobody, no OFFSET overload). ac1-migration-086.log: 086 applied twice, exit 0 both, one campaign_audience_members signature. ac1-upgrade-from-first-cut.log: fixed 086 over the first cut, exit 0, old overload gone."}
  AC-2: {result: pass, evidence: "src/infrastructure/supabase/repositories/__tests__/campaign-audience-defaults-repository.test.ts: 2/3 red before (row got monthly_send_limit 1000; missing restaurant seeded), 3/3 after; growth tenant with no row → 10000; existing row keeps 12345 / cap 2; settings route test 24/24"}
  AC-3: {result: pass, evidence: "src/app/api/dashboard/campaigns/[id]/__tests__/route.test.ts 'audience filter snapshot': 5/6 red before, 6/6 after (skip-only keeps 60 days, lapsed-only keeps red_yellow, {type:'winback'} → 30 from tenant default, keeps 60 when saved)"}
  AC-4: {result: pass, evidence: "settings-regroup.test.ts (QR links → /dashboard/setup/welcome, red 2/2 before; yellow copy en + zh-HK no 89/gap, red 3/3 before); get-template-review-detail.test.ts (countAudience called with audienceQueryForCampaign, lapsed 30 / skip red, red 4 before); campaign-audience-parity.test.ts (birthday + all → zeros, no RPC, send [] ; red before); flagged count route.test.ts + flagged-receipt-count.test.ts (head count, refresh on decision; red before)"}
  AC-5: {result: pass, evidence: "ac5-full-suite.log: resource-lock heavy, 661 files / 7528 passed, 0 failed (round 1, ac5-full-suite-round1.log: 1 failure from my F6 column change in template-review-detail-queries.test.ts, fixed in 16d4c9d8). ac5-tsc.log: tsc --noEmit exit 0. ac5-lint.log: 1 error in flagged-receipts-panel.tsx (react-hooks/immutability on fetchFlagged), present at base 45d07224, 0 commits on that file since merge base 275785f2"}
  AC-6: {result: pass, evidence: "10 local commits on feature/camp-016-audience-quality after 45d07224 (9 fix/test + the docs commit carrying this file), not pushed (per brief); git status clean; git grep for conflict markers → 0"}
decisions:
  - "F2: seed rather than error. planCampaignQuota (TS mirror of 078's plan_monthly_send_limit, contract-tested) instead of an RPC to the SQL helper: same numbers, no extra round trip, and the guardrail's planDerivedDefaults already uses it"
  - "F3: F1 and F3 share one commit (both edit campaign_audience_rated/members and the same DB test). 086 gains DROP FUNCTION IF EXISTS for the first cut's OFFSET signature so a DB that ran the first cut keeps no stale overload"
  - "F4: an edit of a pre-086 legacy win-back that touches a filter gets the tenant lapsed default (not schedule.inactiveDays) and includes never-visited members joined before the cutoff"
  - "F6: the admin's 'selected' label changed from '{count} selected' (picked rows) to '{label} · {count} members' (will receive); the now-unused key campaignAudienceSelected and countCampaignMembers were removed"
  - "F7: kept audienceQueryForPreview type-free because Settings' distribution bar counts every member; the shared rule is the exported isNonBroadcastAll"
  - "F8: framework-free count/decide functions + an EventTarget signal (the repo has no React renderer for hook tests)"
  - "F9 zh-HK wording: '{yellow}% 至低於 {green}% 送達' (matches the red line's 低於)"
failed:
  - "First full-suite round: template-review-detail-queries.test.ts expected the old panel fields; updated for the snapshot columns (16d4c9d8)"
invariants:
  - "Count, send and the admin review size all resolve through campaign_audience_counts/members with the same AudienceQuery"
  - "tenant_campaign_settings is never created from column defaults by app code"
  - "Recipient walk is keyset; readAllPages (OFFSET) remains only for the 079 paths"
unverified:
  - "No browser walk this round (local Supabase stack not running): QR links, flagged pill refresh, the yellow copy on screen and the admin review panel are unit-tested only"
  - "Keyset paging through real PostgREST (only psql against the function)"
  - "Send performance: each keyset page still rates the whole audience before filtering by id"
review_focus:
  - "supabase/migrations/086_campaign_audience_quality.sql: is_lapsed clause order, DROP of the (…, int, int) signature, grants on the (…, int, uuid) signature"
  - "src/infrastructure/supabase/repositories/campaign-audience-defaults-repository.ts: seed-then-update race (ignoreDuplicates)"
  - "src/application/get-template-review-detail.ts sizeAudience null vs 0"
scope_drift:
  - "src/components/admin/template-review-campaigns.tsx + i18n key removal (F6 made the old label wrong)"
  - "src/infrastructure/supabase/repositories/receipt-repository.ts gains countFlaggedReceipts (F8)"
next_step: "main pushes the branch, reads PR #200 CI, owner reviews and gives the go for releasing 086."
