---
id: artifacts/2026-11-03-waq-011-detail-r2-handoff
type: handoff
contract: handoff-file-v1
author: dev
created: 2026-11-03
status: active
item: WAQ-011-DETAIL-R2
state: done
brief: inline
base: 0ea713cd
head: 4962e4104d75e5afbfaa3eed015e31ddc2b190b7
branch: feature/admin-template-review-detail
pushed: true
stage: poc
suite_changed: false
gate: {result: none, at: none}
next: {owner: main, action: "re-review PR https://github.com/xavierau/omc/pull/174 (round 2); add testids template-review-campaigns-error + template-review-preview-media-external to ui-map/testid-registry.md"}
blockers: []
refs: [artifacts/2026-11-03-waq-011-detail-r1-handoff, artifacts/2026-11-03-waq-011-detail-r2-evidence]
---
ac:
  AC-1: {result: pass, evidence: "RED first: 44 failing across the touched files before any implementation. GREEN: npx vitest run src/application/__tests__/get-template-review-detail.test.ts 'src/app/api/admin/template-reviews' src/components/admin/__tests__ src/hooks/__tests__ src/messages → 29 files / 286 tests. New cases: store reopen of the same review → isLoading true, detail null until THAT fetch resolves; late response from the earlier open ignored; close clears result; viewForReview returns loading before the store catches up. Use case: listCampaigns throws → campaigns null + campaignsError, one warn; name fallback throws → template null + campaignsError, one warn; payload keys exactly [review, template, campaigns, campaignsError]. Route (real use case, repos faked) → 200 with campaignsError, no restaurant/submitterEmail/templateMissing. UI: null template → 'templateUnavailable' notice + retry calling refetch; no 'no campaigns' claim when template null; campaigns-error notice. Media: Supabase-host URL → next/image, scontent*.whatsapp.net → video, attacker host → text only (no img/video/a). Date via useFormatter().dateTime with timeZone Asia/Hong_Kong. template-review-preview.test.tsx (render level) was written after the model change; its model-level twin was red first."}
  AC-2: {result: pass, evidence: "DEV fallback harness, zh-HK, next dev :3071, throwaway platform admin, reached 範本審核 via sidebar nav. Fixture made by the REAL r2 use case against DEV (faked: findReviewById, since DEV lacks template_review_queue; and listCampaignsUsingTemplate for the campaigns-error review only). Measured: external media → '未載入外部媒體' + placehold.co URL as text, 0 img/video/a in preview, 0 requests to placehold.co; schedule date '排程：2026年11月20日 上午10:00'; close + reopen same review with fetch held → loading visible, 0 stale preview/cards, buttons [true,true,true], then enabled after load; could-not-load notice '無法載入範本記錄：範本可能已被刪除，或查詢失敗。…' + 重試 (retry refetched 1→2), no campaigns section; campaigns-error '無法載入使用此範本的推廣活動。' with preview still shown; Supabase-host header → img (host ooknbeigovltchbgonjk.supabase.co). No non-GET requests, 0 console errors. Layout audit: desktop 0 blocking / 1 warning (pre-existing admin shell row-misaligned), mobile 0/0. Screenshots: .claude-workspace/artifacts/2026-11-03-waq-011-detail-r2-evidence/r2-panel-{external-media-desktop,external-media-mobile,schedule-date-desktop,reopen-loading-desktop,could-not-load-desktop,campaigns-error-desktop,supabase-image-desktop}.jpg. Cleanup: 1 campaign, platform_admins row, auth user deleted; verified [] / [] / 404; creds file deleted."}
  AC-3: {result: pass, evidence: "python3 ~/.claude/bin/resource-lock.py heavy -- npx tsc --noEmit -p . → exit 0. npx eslint on all 15 touched src files → 'No issues found'. Impeccable detect on the 3 changed components → exit 0, []."}
  AC-4: {result: pass, evidence: "commit pushed to feature/admin-template-review-detail (PR #174) via rtk proxy git push; ls-remote == HEAD; not merged"}
decisions:
  - "R2-1: hook rebuilt on the repo's framework-free store + useSyncExternalStore precedent (use-tag-recipient-count): createTemplateReviewDetailStore.open(id|null) bumps a generation, so every open (including the same id) starts loading with no result and only that open's response is applied; viewForReview covers the one render before the effect reaches the store."
  - "R2-2/R2-3: templateMissing deleted; template null → notice key templateUnavailable (replaces templateMissing) + the existing detailRetry button; same notice for an id-less review the name lookup didn't find. findByIdForRestaurant untouched."
  - "R2-4: template lookups that throw are caught too (not only the name fallback) → template null + campaignsError. When template is null without a throw, campaigns is null (unknown) and the Campaigns section is omitted, so the panel never says 'no campaigns' about a template it couldn't load. Previously this returned []."
  - "R2-5: allowlist on URL.host (port must match): Supabase host from NEXT_PUBLIC_SUPABASE_URL, /^scontent[a-z0-9.-]*\\.whatsapp\\.net$/, lookaside.fbsbx.com. Off-list → kind 'external', rendered as text with testid template-review-preview-media-external. DOCUMENT headers unchanged (anchor, user-click only), not named in R2-5."
  - "R2-6: detail payload is {review, template, campaigns, campaignsError}; ReviewEnrichmentDeps split out for enrichTemplateReviews (list route unchanged)."
  - "R2-8: format.dateTime(date, {dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Hong_Kong'}); the explicit timeZone avoids next-intl's ENVIRONMENT_FALLBACK since the provider sets none."
failed: []
invariants:
  - "GET /api/admin/template-reviews/[id] stays read-only and platform-admin only; the walk aborted any non-GET (none were sent)"
  - "A review that names a templateId is never shown a different template"
unverified:
  - "Real template_review_queue → panel round trip (DEV lacks the table); first prod admin open of Bicho nov_promo_2026"
  - "Playwright feature spec + scripts.layout not run: repo has no ui-map/harness.md; ad-hoc layout-audit.js run instead"
review_focus:
  - "src/hooks/use-admin-template-review-detail.ts — store generation + viewForReview"
  - "src/application/get-template-review-detail.ts — resolveTemplate/campaignsFor degrade paths"
  - "src/components/admin/template-review-preview-model.ts — isAllowedMediaUrl"
scope_drift: []
in_flight: []
next_step: "Main thread: re-review PR #174; add the two new testids to ui-map/testid-registry.md."
---

Media hosts seen (read-only, 2026-11-03), for the escalate_if check:
- prod (uzimqndenngebzgndlhd): 9 templates; IMAGE ×6 and VIDEO ×1 on the project Supabase host, 1 non-URL handle (shows as "no preview"). nov_promo_2026: IMAGE on the Supabase host, so it renders. Read with node on the prod box using the site .env key; only host tallies were printed.
- DEV (ooknbeigovltchbgonjk): 2 IMAGE headers on the Supabase host, and **1 on placehold.co** (birthday_greeting, a draft seed template). It now shows "External media not loaded". The allowlist was not widened.

Not written (outside files_allowed): `.claude-workspace/INDEX.md` / `active/` entry, `poc-log.md`, `ui-map/testid-registry.md` rows. CLAUDE.md in the tree was modified by `next dev` (Next agent-rules block). It was not committed.
Scratch harness: /private/tmp/claude-501/-Users-xavierau-Code-js-whatsapp-crm/bdfef48c-dcb4-4bd8-a403-801b635fbedc/scratchpad/r2/ (seed.cjs, gen.ts, walk.cjs, cleanup.cjs).
