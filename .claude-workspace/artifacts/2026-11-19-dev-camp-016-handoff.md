---
id: artifacts/2026-11-19-dev-camp-016-handoff
type: handoff
contract: handoff-file-v1
author: dev (camp-016)
created: 2026-11-19
status: active
item: CAMP-016
state: done
brief: inline brief-v1 (main dispatch 2026-11-19)
base: 49a3f582
head: 91ba990afa01640ea4f24ff98938727c422c5043
branch: feature/camp-016-audience-quality
pushed: true
stage: poc
suite_changed: false
gate: {result: pass, at: 2026-11-19T13:30Z}
next: {owner: main, action: "POC: owner review of the PR into develop; release (migration 086) needs owner go"}
blockers: []
refs: [artifacts/2026-11-19-camp-016-plan, artifacts/2026-11-19-settings-campaign-quality-ux, artifacts/2026-11-19-camp-016-impl, artifacts/2026-11-19-camp-016-evidence]
---
ac:
  AC-1: {result: pass, evidence: "evidence/ac1-migration-086.log: scratch DB 001..085 (incl. peer 085_agent_booking_changes) then 086, exit 0, re-apply idempotent; existing tenant red|30, all rows complete; existing campaign off|NULL; new tenant via the 078 trigger red|30; the 3 CHECKs reject bad values"}
  AC-2: {result: pass, evidence: "src/infrastructure/supabase/__tests__/campaign-audience-rpcs.db.test.ts: 29/29 red before the migration (evidence/ac2-red.log), 29/29 green on 001..085 + 086 (evidence/ac2-green-086.log)"}
  AC-3: {result: pass, evidence: "src/app/api/dashboard/settings/campaigns/__tests__/campaign-settings.route.test.ts 24/24 (GET any member, PUT admin only, 400 fields, tenant from session, aggregates only); walk: staff PUT 403, row unchanged"}
  AC-4: {result: pass, evidence: "src/application/__tests__/campaign-audience-parity.test.ts 18/18; resolve-campaign-members.test.ts 15/15 incl. pre-086 campaigns; real UI: the form showed 27 and the resolver on the stored snapshot returned 27 (en, zh-HK, 2 post-merge runs)"}
  AC-5: {result: pass, evidence: "evidence/shots/en-settings-campaigns-1440.png, en-settings-{profile,messages,bookings,welcome,receipts}-1440.png, en-settings-index-390.png, en-settings-campaigns-390.png, zh-HK equivalents; layout audit 0 blocking on new screens (2 blocking on bookings/welcome = Next dev-tools portal over Log Out, refuted)"}
  AC-6: {result: pass, evidence: "evidence/shots/en-campaign-form-tags-lapsed-1440.png, en-campaign-form-summary-1440.png, en-campaign-form-zero-1440.png, zh-HK equivalents, shots-merged/; badge tooltip text in walk.log"}
  AC-7: {result: pass, evidence: "evidence/ac7-tsc.log exit 0 under the heavy lock; eslint on touched files: 1 error + 1 warning, both present at base 49a3f582 (evidence/ac7-lint.log)"}
  AC-8: {result: pass, evidence: "branch pushed (ls-remote SHA == HEAD); PR into develop; kanban CAMP-016 in review; testid-registry rows appended + 17 /dashboard/setup rows re-pointed to /bookings; poc-log line"}
decisions:
  - "Migration renumbered 085 -> 086: AGENT-003 (#195) landed 085_agent_booking_changes on develop first; no table overlap; merged origin/develop 7af9494b into the branch"
  - "Pre-086 campaigns: a snapshot of off/NULL means no filter, except a win-back to all members, which keeps schedule.inactiveDays (default 30) and excludes never-visited members"
  - "Win-back always has a lapsed filter (server fills the tenant default); the form toggle is on and locked for win-back, off for other types until the user sets it (brief only said win-back defaults on)"
  - "Form skip level = the Settings level (design has only toggle + 'Default from Settings · Change'); an edit keeps the campaign's own snapshot"
  - "Desktop /dashboard/setup redirects client-side to profile (matchMedia); phone keeps the index"
  - "Non-admin Campaigns group is read-only (controls disabled, Save hidden); Bookings group hidden and 404 by URL"
failed:
  - "Post-merge walk stored lapsed NULL where earlier runs stored 30 for the same clicks: the late Settings pre-fill flipped the lapsed toggle after the type change. Fixed in 91ba990a (lapsedForType + filtersTouched guard); two runs after the fix both stored tag|red|30"
invariants:
  - "Count, Settings distribution and send all go through campaign_audience_rated; never PostgREST .in() on member ids"
  - "Send reads the campaign snapshot, never live tenant settings"
  - "Quality classification = classifyContactQuality with thresholds/window passed as params; no data is never excluded; unreachable = red"
  - "Resolver EXECUTE revoked from anon/authenticated; p_restaurant_id on every join"
  - "Consent/cooldown gates (execute-campaign-batch-gate.ts) unchanged"
unverified:
  - "Settings quality error/empty states, settings save error and form count error were not walked (render paths only)"
  - "Send performance on very large audiences: campaign_audience_members re-rates the audience per 1,000-row page"
  - "zh-HK and staff walks ran before the merge and the toggle fix; only the en walk re-ran after"
review_focus:
  - "supabase/migrations/086_campaign_audience_quality.sql: float8 rate boundaries vs JS, tenant scoping of the selected/campaign_members path, grants"
  - "src/application/campaign-audience-query.ts: legacy win-back rule"
  - "src/components/dashboard/campaign-form-dialog.tsx: pre-fill vs filtersTouched and lapsedForType"
scope_drift:
  - ".env.example appears in base..HEAD only through the origin/develop merge (AGENT-003 #195); this branch did not edit it"
  - "079 functions active_members_by_tags / active_members_by_campaign_selection left in place though no longer called"
next_step: "Owner reviews PR #200 into develop and gives the go for releasing migration 086."
