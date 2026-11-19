---
id: artifacts/2026-11-19-dev-camp-016-r2-handoff
type: handoff
contract: handoff-file-v1
author: dev (camp-016 r2)
created: 2026-11-19
status: active
supersedes: artifacts/2026-11-19-dev-camp-016-handoff
superseded_by: null
item: CAMP-016
state: blocked
brief: inline
base: e1475fb06d8e4cb687de2507ce8e4c13fb225f1b
head: fe61ceb40a883cd4cc07b6be433ab48076e02e74
branch: feature/camp-016-audience-quality
pushed: false
stage: poc
suite_changed: false
gate: {result: none, at: null}
next: {owner: main, action: "push feature/camp-016-audience-quality (the push was denied by the permission system), then confirm PR #200 MERGEABLE and read the CI runs"}
blockers:
  - "git push of feature/camp-016-audience-quality denied by the permission system (OMC repo is public) — needs owner/main to push or allow the push"
refs: [artifacts/2026-11-19-dev-camp-016-handoff, artifacts/2026-11-19-camp-016-impl, artifacts/2026-11-19-camp-016-evidence]
---
ac:
  AC-1: {result: fail, evidence: "Merge done locally: da84cdb2 = merge of e1475fb0 + origin/develop 279ff4b3. Zero conflict markers (git grep '^(<<<<<<<|>>>>>>>) ' → 0), no U entries before commit. But the branch is not pushed, so gh pr view 200 still reports headRefOid e1475fb0, mergeable UNKNOWN."}
  AC-2: {result: pass, evidence: "evidence/shots-r2/en-campaign-form-summary-r2-1440.png (promo + Tags VIP + Lunch regulars: tag hint, then filters, then summary 60 / − 3 / Will receive 57; no 'will receive this' line); walk-r2.log: legacy [data-field=recipient-count] count=0. Welcome + Tags keeps the legacy line (no summary there): en-campaign-form-welcome-r2-1440.png. Layout audit 0 blocking on both."}
  AC-3: {result: pass, evidence: "vitest run campaign-tag-picker.test.tsx, campaign-target-audience-fields.test.tsx (new), campaign-tag-recipient-count.test.tsx → 3 files, 15/15; the new audience-fields test was red (3/3) against the old wiring. resource-lock heavy -- npx tsc --noEmit → exit 0, no output."}
  AC-4: {result: fail, evidence: "push denied by the permission system; remote branch still at e1475fb0 (git ls-remote); no CI run for the new head"}
decisions:
  - "Legacy line hidden by a prop, not removed: CampaignTagPicker gets showRecipientCount (default true); CampaignTargetAudienceFields passes form.type === 'welcome'. The summary renders only for non-welcome types (campaign-form-fields.tsx), so a welcome tag campaign would otherwise lose its only count. Component, hook and i18n keys stay in use, so nothing is orphaned [brief decide_yourself]"
  - "testid-registry merge: develop's row order; the agent-settings rows present on both sides keep CAMP-016's /dashboard/setup/bookings route (AgentSettingsSection renders in BookingsGroup, src/app/dashboard/setup/[group]/groups.tsx)"
  - "INDEX and poc-log merge: develop's BOOK-004/AGENT-003 entries first, then CAMP-016's"
failed: []
invariants:
  - "Only en.json/zh-HK.json were touched by both sides in src/; key-level check: every develop key is in the merge, every CAMP-016 key too except bookings.emptyTitle/emptyDescription, which BOOK-004 r3 deleted on purpose (orphans, no code uses them). kanban.json valid, no item id lost from either side."
  - "Every other develop-touched src/supabase/e2e file is byte-identical to origin/develop after the merge (BOOK-004 lost nothing)."
unverified:
  - "CI on the merged head (not pushed) — main"
  - "Full vitest suite after the merge not run (brief asked for touched files + tsc only) — CI"
  - "390 and zh-HK walk of the r2 change not run (brief asked 1440 en) — main"
review_focus:
  - "src/components/dashboard/campaign-target-audience-fields.tsx: showRecipientCount={form.type === 'welcome'} mirrors campaign-form-fields.tsx's `form.type !== 'welcome'` summary condition; if one changes, the other must"
scope_drift:
  - "src/app/api/dashboard/bookings/**, src/app/dashboard/bookings/page.tsx, src/app/globals.css, src/domain/entities/booking-request.ts, src/infrastructure/supabase/repositories/** differ from base only through the develop merge (BOOK-004 #196 files, byte-identical to origin/develop); no hand edit outside files_allowed"
in_flight: []
next_step: "Push feature/camp-016-audience-quality (rtk proxy git push origin feature/camp-016-audience-quality), verify ls-remote == HEAD, then gh pr view 200 --json mergeable and gh run list --branch feature/camp-016-audience-quality."
notes:
  - "Rig: local Supabase stack (086 applied by supabase start from this tree), legacy-grants.sql (local only), seed.sh synthetic tenant, next dev -p 3040, Playwright evidence/walk-r2.mjs; stack released after the walk"
  - "next dev rewrote the tracked repo CLAUDE.md (Next 16 agent rules); reverted with git checkout, not committed"
  - "FYI seen, not touched: the welcome campaign sheet shows the Welcome image heading and hint twice (en-campaign-form-welcome-r2-1440.png)"
