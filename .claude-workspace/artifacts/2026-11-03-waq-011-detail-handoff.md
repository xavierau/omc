---
id: artifacts/2026-11-03-waq-011-detail-handoff
type: handoff
contract: handoff-file-v1
author: dev
created: 2026-11-03
status: active
item: WAQ-011-DETAIL
state: done
brief: inline (brief-v1 WAQ-011-DETAIL)
base: 07316f36
head: aee76d54
branch: feature/admin-template-review-detail
pushed: true
stage: poc
suite_changed: false
gate: {result: none, at: null}
next: {owner: none, action: "owner reviews PR https://github.com/xavierau/omc/pull/174 (against develop, not merged) (POC: /code-review optional; read-only admin path, no money/auth/data-loss write)"}
blockers: []
refs: [artifacts/2026-11-03-waq-011-detail-evidence]
---
ac:
  AC-1: {result: pass, evidence: "npx vitest run src/application/__tests__/get-template-review-detail.test.ts 'src/app/api/admin/template-reviews' → 3 files / 22 tests green; RED first (modules missing) before implementation. Touched-file sweep incl. components/admin, messages parity: 129 tests green"}
  AC-2: {result: pass, evidence: "DEV lacks template_review_queue and campaign_tags (PGRST205) — real list/detail GET return 500 on DEV, malformed id → 400. Fallback per brief: seeded 2 throwaway campaigns (+3 campaign_members) in test tenant 00000000-…-0001 on its real birthday_greeting template, ran the REAL use case against DEV with only findReviewById faked → restaurant 'The Green Kitchen', submitter email, template, selected count 3, 'all' → null. Fed that JSON to the real UI via Playwright page.route on the dev server (localhost:3071, zh-HK), logged in as a throwaway DEV platform admin, reached 範本審核 via sidebar nav. Screenshots: .claude-workspace/artifacts/2026-11-03-waq-011-detail-evidence/{table-desktop,panel-desktop,panel-desktop-bottom,panel-mobile,panel-error}.jpg. Sheet measured 720px; image naturalWidth 600; 2 campaign cards; error → 重試 → preview. All seeded rows, both admin rows and both auth users deleted and verified gone (GET [] / 404)."}
  AC-3: {result: pass, evidence: "tsc: python3 ~/.claude/bin/resource-lock.py heavy -- npx tsc --noEmit -p . → exit 0, no errors. eslint on touched files: 2 errors, both react-hooks/set-state-in-effect at lines present on origin/develop (template-review-decision-sheet.tsx:36, use-admin-template-reviews.ts:60); 0 new. Impeccable detect on the 5 changed components: exit 0, 0 findings"}
  AC-4: {result: pass, evidence: "https://github.com/xavierau/omc/pull/174 (against develop, not merged)"}
decisions:
  - "Audience size for 'all' is null ('—'): no existing restaurant active-member count exists, and 'all' resolves differently by campaign type (promo = active, winback = inactive-since, birthday = none) — a raw active count would mislead [brief: reuse-or-null]"
  - "'selected' size uses a head count on campaign_members (new countCampaignMembers), not getCampaignMemberIds().length — the latter is truncated at PostgREST max-rows 1000 with no error"
  - "Per-campaign audience-count failure degrades to null + console.warn instead of failing the panel (DEV has no campaign_tags; the template preview still matters most)"
  - "Template resolved by review.templateId scoped to the review's restaurant (findByIdForRestaurant), falling back to latest non-deleted (restaurant, name) row by updated_at when the id is absent OR no longer resolves"
  - "List enrichment (enrichTemplateReviews) is exported from the detail use case and shared by both routes: one restaurants .in() query, one auth getUserById per distinct UUID submitter; legacy 'unknown' submitters skipped"
  - "Use case takes an injectable deps object (defaults = real repos) so the unit test uses fakes, not module mocks"
  - "next/image with unoptimized for the header image (project ESLint convention, memory feedback_eslint_fixes) — renders a plain <img>"
  - "Detail hook derives loading from (reviewId, attempt) of the stored result instead of setState inside the effect (avoids react-hooks/set-state-in-effect and ignores stale responses)"
  - "Removed orphaned i18n key panelAudience (old panel row dropped per brief's Summary list); reused panelTenant for the restaurant-name row"
failed:
  - tried: "chrome-devtools MCP for the browser pass"
    why: "profile already held by another agent's Chrome"
    evidence: "new_page error: browser already running for chrome-profile"
    replaced_by: "standalone Playwright (scratchpad install) with its own browser"
invariants:
  - "GET /api/admin/template-reviews/[id] stays read-only and platform-admin only (assertPlatformAdmin before any lookup)"
  - "Header media only renders when the stored handle parses as an https URL (safeHttpsUrl); no dangerouslySetInnerHTML anywhere in the panel"
unverified:
  - "Prod template shapes (e.g. Bicho nov_promo_2026) not read — DEV shapes cover IMAGE (both handle keys), TEXT header, BODY, FOOTER, COPY_CODE/QUICK_REPLY/URL buttons; VIDEO and PHONE_NUMBER covered by unit tests only — owner on first prod use"
  - "Real template_review_queue → panel round trip on a DB that has the table (DEV lacks it) — first prod/staging admin open"
  - "Tag-audience counts against a DB with campaign_tags + RPC 067 (DEV lacks them) — unit-tested only"
  - "Playwright feature spec + scripts.layout not run: repo has no ui-map/harness.md (scaffold is its own work item); ad-hoc layout-audit.js run instead (0 blocking from this diff)"
review_focus:
  - "src/application/get-template-review-detail.ts — cross-tenant lookups rely on the route's assertPlatformAdmin"
  - "src/components/admin/template-review-preview-model.ts — URL admission rule"
  - "src/infrastructure/supabase/repositories/template-review-detail-queries.ts — campaigns capped at 50 per template"
scope_drift: []
in_flight: []
next_step: "Owner reviews the PR; after merge, add testids template-review-detail-loading/-error, template-review-preview, template-review-campaign-<id>, template-review-campaigns-empty to .claude-workspace/ui-map/testid-registry.md (outside this brief's files_allowed)."
---

Not written (outside files_allowed): `.claude-workspace/INDEX.md` / `active/` entry, `poc-log.md` entry, `ui-map/testid-registry.md` rows.
Layout audit: desktop 1440×900 panel 0 blocking / 1 warning (pre-existing admin shell `row-misaligned`, sidebar vs content); mobile 390×844 0/0. One run reported `occluded` on the sidebar 登出 button by `nextjs-portal` — the Next.js dev overlay, dev-only, refuted.
Console errors during the walk: two 500s — the forced detail failure for the error state, and the DEV list endpoint (missing table).
