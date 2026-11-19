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
