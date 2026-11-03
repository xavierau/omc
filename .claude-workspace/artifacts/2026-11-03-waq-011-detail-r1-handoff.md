---
id: artifacts/2026-11-03-waq-011-detail-r1-handoff
type: handoff
contract: handoff-file-v1
author: dev
created: 2026-11-03
status: active
item: WAQ-011-DETAIL-R1
state: done
brief: inline (brief-v1 WAQ-011-DETAIL-R1)
base: 805727c9
branch: feature/admin-template-review-detail
pushed: true
stage: poc
suite_changed: false
gate: {result: none, at: null}
next: {owner: main, action: "re-review PR https://github.com/xavierau/omc/pull/174 (round 1); add testids template-review-submitted-content + template-review-template-missing to ui-map/testid-registry.md"}
blockers: []
refs: [artifacts/2026-11-03-waq-011-detail-handoff, artifacts/2026-11-03-waq-011-detail-r1-evidence]
---
ac:
  AC-1: {result: pass, evidence: "RED first: 24 failing / 17 passing across the 6 touched test files before implementation. GREEN: npx vitest run src/application/__tests__/get-template-review-detail.test.ts 'src/app/api/admin/template-reviews' src/components/admin/__tests__ src/infrastructure/supabase/repositories/__tests__/admin-identity-lookups.test.ts src/infrastructure/supabase/repositories/__tests__/template-review-detail-queries.test.ts src/messages/__tests__ → 16 files / 104 tests green. Cases: templateId set + not found → templateMissing, findLatestTemplateByName never called; templateId null → latest-by-name (see decisions: no language on the review); restaurant-name failure → empty map, list route 200 with restaurantName null (route-degraded-lookups.test.ts, real use case + real lookups, failing client); listUsers error/throw → emails null, listUsers called once with perPage 1000, getUserById never; .in() chunked 200/200/50; scheduleLabel completed/failed/schedule-json/scheduledAt/manual; 'selected' → campaignAudienceSelected; DecisionButtons disabled when locked, enabled when not, disabled in flight"}
  AC-2: {result: pass, evidence: "Same DEV fallback harness as round 0: seeded 4 throwaway campaigns (birthday schedule-json active, one-off scheduled_at, completed, manual 'selected' + 3 campaign_members) on tenant 00000000-…-0001 template birthday_greeting; ran the REAL r1 use case against DEV with only findReviewById faked (DEV lacks template_review_queue). A review with a non-existent templateId came back templateMissing: true with no name fallback although birthday_greeting exists by name. Fed the JSON to the real UI via Playwright page.route on next dev :3071 (zh-HK), logged in as a throwaway DEV platform admin, reached 範本審核 via sidebar nav. Measured: detail held → 批准/拒絕/要求修改 disabled [true,true,true], submitted text visible; loaded → enabled; headings 摘要 / 已提交的內容 / 目前範本（可能與提交內容不同） / 使用此範本的推廣活動, submitted above preview; 提交時目標人數 1,234; schedule labels 自動（觸發／定期）, 排程：20/11/2026…, 已發送, 手動發送; selected 已選 3 位; missing → notice, 0 previews; detail 500 → buttons enabled, submitted text visible. Screenshots: .claude-workspace/artifacts/2026-11-03-waq-011-detail-r1-evidence/r1-panel-{loading,loaded,campaigns,missing,error}-desktop.jpg, r1-panel-loaded-mobile.jpg. Cleanup: campaign_members, 4 campaigns, platform_admins row, auth user deleted; verified [] / [] / [] / 404"}
  AC-3: {result: pass, evidence: "python3 ~/.claude/bin/resource-lock.py heavy -- npx tsc --noEmit -p . → exit 0, no output (queued behind another repo's Playwright run, < 20 min). eslint on every touched file: 1 error, react-hooks/set-state-in-effect at template-review-decision-sheet.tsx reset effect (setNotes in useEffect) — present on origin/develop, recorded in round 0; 0 new. Impeccable detect on the 4 changed components: exit 0, []"}
  AC-4: {result: pass, evidence: "commit 'fix: admin template review detail — submitted content, no silent fallback, degraded lookups (review round 1)' pushed to feature/admin-template-review-detail, PR https://github.com/xavierau/omc/pull/174; ls-remote == HEAD; not merged"}
decisions:
  - "F1 language: TemplateReviewProps and template_review_queue have no language column, and the tenant submit route accepts none. The same-language rule therefore never applies; id-less reviews fall back to latest-by-name, which is F1's 'otherwise' branch. I did not escalate because F1 states that branch. A language-constrained fallback would need a migration plus a submit-route change (outside files_allowed). The F2 'may differ' label and the Submitted content section cover the remaining risk"
  - "templateMissing = (template === null): true for both a templateId that no longer resolves and an id-less review whose name finds nothing; the UI shows the notice in both cases"
  - "findByIdForRestaurant swallows errors → a null from a failed read is also reported as templateMissing (no fallback), per F1"
  - "F3: the detail hook moved from TemplateReviewDetailSections up to the sheet (which owns the buttons); sections now take the state as a prop, which also made them unit-testable without the hook. DecisionButtons extracted to template-review-decision-buttons.tsx with a `locked` prop"
  - "F4: deps.findUserEmail(id) replaced by deps.findUserEmails() (Map); skipped entirely when no submitter is a UUID; findUserEmailById deleted (no other callers)"
  - "F5: findRestaurantNamesByIds chunks in parallel at RESTAURANT_NAME_CHUNK=200; any chunk failure → one console.warn, empty map (no partial maps)"
  - "F6 order: completed/failed first, then schedule JSON, then scheduledAt, then manual. New keys campaignScheduleSent / campaignScheduleFailed instead of reusing campaignStatus.completed (zh '已完成', brief asked '已發送')"
  - "F9: [id] route GET and POST both use isValidUUID; the route's UUID_REGEX became orphaned and was removed (it predated this PR but lived in the named route)"
  - "i18n: removed orphaned keys sectionPreview and campaignSendNow; templateMissing text reworded to point at the submitted content above"
failed:
  - tried: "seed script wrote seeded.json + admin-creds.json relative to cwd (the worktree root)"
    why: "relative paths in a script run from the worktree"
    evidence: "both files moved to the scratchpad before any git add; git status showed neither; creds file deleted after cleanup"
    replaced_by: "scratchpad paths"
invariants:
  - "GET /api/admin/template-reviews/[id] stays read-only and platform-admin only (assertPlatformAdmin before any lookup); the browser walk aborted every non-GET request, so no decision was made"
  - "A review that names a templateId is never shown a different template"
unverified:
  - "Real template_review_queue → panel round trip (DEV lacks the table); first prod/staging admin open (e.g. Bicho nov_promo_2026)"
  - "listUsers perPage 1000 covers every prod user: relies on the brief's <20 users on prod (not read)"
  - "Playwright feature spec + scripts.layout not run: repo has no ui-map/harness.md; ad-hoc layout-audit.js run instead — desktop 0 blocking / 1 warning (pre-existing admin shell row-misaligned), mobile 0/0"
review_focus:
  - "src/application/get-template-review-detail.ts resolveTemplate — no fallback when templateId is set"
  - "src/infrastructure/supabase/repositories/admin-identity-lookups.ts — degrade semantics (all-or-nothing on chunk failure)"
  - "src/components/admin/template-review-decision-sheet.tsx — hook lifted above the `if (!review) return null` early return"
scope_drift: []
in_flight: []
next_step: "Main thread: re-review PR #174; add the two new testids to .claude-workspace/ui-map/testid-registry.md."
---

Not written (outside files_allowed): `.claude-workspace/INDEX.md` / `active/` entry, `poc-log.md`, `ui-map/testid-registry.md` rows (template-review-submitted-content, template-review-template-missing).
Console errors during the walk: one 500, the forced detail failure for the error state.
