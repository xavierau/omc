# Workspace Index

_Last updated: 2026-07-28 — rebuilt by scanning the artifact frontmatter on disk after the
previous index was accidentally overwritten by a worktree-local index. Descriptions are
derived from each file's title/frontmatter, so wording may differ from the original entries;
no artifact files were lost._

## Active

### UI Map
- [ui-map/INDEX.md](ui-map/INDEX.md) — scaffolded 2026-08-24 (ui-test-runner), all fields TODO, no run has occurred yet

### Specs
- [2026-06-07-stamp-collection-campaign](specs/2026-06-07-stamp-collection-campaign.md) — PRD: Stamp Collection Campaign ("Digital Stamp Card") (product-manager)

### Plans
- [2026-08-28-wonb-018-019-csv-parser-and-template](plans/2026-08-28-wonb-018-019-csv-parser-and-template.md) — #148/#147 CSV plan (solution-architect)
- [2026-08-28-tag-001-issues-138-139](plans/2026-08-28-tag-001-issues-138-139.md) — #138/#139 deltas on PR #51: 12 items, mig 067 (solution-architect)
- [2026-08-24-issue-111-member-detail-idor](plans/2026-08-24-issue-111-member-detail-idor.md) — #111: cross-tenant IDOR on the member-detail path — scope all three queries by restaurant_id, 404 on a foreign id (solution-architect)
- [2026-08-24-waq-014-gate-error-diagnosability](plans/2026-08-24-waq-014-gate-error-diagnosability.md) — #117: gate error names trustReason not Meta
- [2026-07-28-tpl-009-template-status-sync](plans/2026-07-28-tpl-009-template-status-sync.md) — Issue #93: Forge cron + template-status webhook so Meta template statuses sync (solution-architect) — _carries a post-review amendment; AC3 superseded_
- [2026-07-26-reply-007-per-tenant-contact-flow](plans/2026-07-26-reply-007-per-tenant-contact-flow.md) — REPLY-007: per-WABA flow id + per-tenant form labels (solution-architect)
- [2026-07-26-reply-005-contact-form-flow](plans/2026-07-26-reply-005-contact-form-flow.md) — REPLY-005: contact-us mode — redirect | WhatsApp Flow form → email + ack (solution-architect)
- [2026-07-15-tpl-003-template-meta-submission](plans/2026-07-15-tpl-003-template-meta-submission.md) — TPL-003: templates stuck in draft — prepare components for Meta, propagate rejections (solution-architect)
- [2026-07-06-reply-001-contact-redirect](plans/2026-07-06-reply-001-contact-redirect.md) — REPLY-001: contact-redirect action in the fallback reply menu (solution-architect)
- [2026-07-03-camp-001-claim-button-flow](plans/2026-07-03-camp-001-claim-button-flow.md) — CAMP-001: claim-button campaign flow, lazy coupon/QR on tap (solution-architect)
- [2026-06-10-dev-whatsapp-mocks](plans/2026-06-10-dev-whatsapp-mocks.md) — Dev-only WhatsApp mock utilities: fake provider + WABA-status simulator (claude)
- [2026-06-09-stamp-collection-build-plan](plans/2026-06-09-stamp-collection-build-plan.md) — Stamp Collection MVP, reviewed and build-ready (solution-architect)

### Threats
- [2026-06-09-stamp-collection-plan-review](threats/2026-06-09-stamp-collection-plan-review.md) — Threat model review of the Stamp Collection plan, post-LOCKED decisions (security-architect)
- [2026-06-07-stamp-collection-loop](threats/2026-06-07-stamp-collection-loop.md) — Threat model: staff-operated stamp collection loop (security-architect)

### Deploys
- [2026-08-28-tag-001-release-runbook](deploys/2026-08-28-tag-001-release-runbook.md) — #138/#139 to prod: #142 → #143 → main 8b18af7 → release 1493ad7, deploy facts, on-box probe of 065–068, blast radius, no-browser-walk caveat (claude)

### Reviews
- [2026-08-28-tag-001-issues-138-139-gemini](reviews/2026-08-28-tag-001-issues-138-139-gemini.md) — #138/#139 d728bb4: CONDITIONAL — 1 Critical (NUL byte made a source file binary; fixed) (gemini-cli-reviewer)
- [2026-08-28-tag-001-issues-138-139-analyzer](reviews/2026-08-28-tag-001-issues-138-139-analyzer.md) — #138/#139 d728bb4 second lane: CONDITIONAL — 0 Critical, 5 Important (NUL byte, CSV tag feedback, bulk success line, raw enum error, audience-scale reads), 13 Minor (code-review-analyzer)
- [2026-08-28-camp-009-issues-136-134-analyzer](reviews/2026-08-28-camp-009-issues-136-134-analyzer.md) — CAMP-009 #136/#134 second lane: CONDITIONAL — 0 Critical, 2 Important ({{code}}+null couponConfig; journal) (code-review-analyzer)
- [2026-08-28-camp-009-issues-136-134-gemini](reviews/2026-08-28-camp-009-issues-136-134-gemini.md) — #136+#134: APPROVED, 0 Critical/Important, 1 Minor (counter-order asymmetry) (gemini-cli-reviewer)
- [2026-08-27-camp-008-issue-131-gemini](reviews/2026-08-27-camp-008-issue-131-gemini.md) — #131 4831b5e: CONDITIONAL, 1 Critical (retract RPC lost-update) (gemini-cli-reviewer)
- [2026-08-27-camp-008-issue-131-analyzer](reviews/2026-08-27-camp-008-issue-131-analyzer.md) — #131 1775d79: CONDITIONAL, 0 Critical, 3 Important (code-review-analyzer)
- [2026-08-27-camp-004-quick-reply-gemini](reviews/2026-08-27-camp-004-quick-reply-gemini.md) — #132 9c41b04: APPROVED (gemini-cli-reviewer)
- [2026-08-27-camp-004-quick-reply-analyzer](reviews/2026-08-27-camp-004-quick-reply-analyzer.md) — #132 9c41b04 second lane: CONDITIONAL — 1 Important (journal), 6 Minor (code-review-analyzer)
- [2026-08-24-camp-007-media-header-analyzer](reviews/2026-08-24-camp-007-media-header-analyzer.md) — CAMP-007 second lane: CONDITIONAL — 2 Important (my-card post-claim throw; stale invariant doc) (code-review-analyzer)
- [2026-08-24-camp-007-media-header-gemini](reviews/2026-08-24-camp-007-media-header-gemini.md) — CAMP-007 media-header send fix (#127): APPROVED, no Critical, 1 Important (no Integration Map) (gemini-cli-reviewer)
- [2026-08-24-issue-111-idor-fix-second-lane](reviews/2026-08-24-issue-111-idor-fix-second-lane.md) — #111 IDOR fix second lane: APPROVED — 0 Critical/Important, 3 Minor noted (code-review-analyzer)
- [2026-08-24-issue-111-idor-fix-gemini](reviews/2026-08-24-issue-111-idor-fix-gemini.md) — #111 member-detail cross-tenant IDOR fix: APPROVED, no Critical/Important/Minor findings (gemini-cli-reviewer)
- [2026-08-24-waq-014-analyzer](reviews/2026-08-24-waq-014-analyzer.md) — WAQ-014 4552918 second lane: CONDITIONAL — 1 Important, length-guard swallow (code-review-analyzer)
- [2026-08-24-waq-014-gemini](reviews/2026-08-24-waq-014-gemini.md) — WAQ-014 gate error diagnosability (#117), 4552918: CONDITIONAL — 1 Critical (test swallows throw) (gemini-cli-reviewer)
- [2026-08-23-release-pipeline-critical-fixes-analyzer](reviews/2026-08-23-release-pipeline-critical-fixes-analyzer.md) — 36dae48 second lane: BLOCKED — 2 Critical (tar excludes strip Next trace runtime; PII already public) (code-review-analyzer)
- [2026-08-23-release-pipeline-critical-fixes-gemini](reviews/2026-08-23-release-pipeline-critical-fixes-gemini.md) — PR #113 follow-up (36dae48), 4 critical devops fixes: APPROVED, 1 Important, 2 Minor (gemini-cli-reviewer)
- [2026-08-23-issue-102-send-feedback-second-lane](reviews/2026-08-23-issue-102-send-feedback-second-lane.md) — PR #109/#102 backend second lane: APPROVED round 2 (33e1f96) — all 7 conditions verified fixed (code-review-analyzer)
- [2026-08-23-issue-77-email-queue-second-lane](reviews/2026-08-23-issue-77-email-queue-second-lane.md) — PR #106/#77 email queue second lane, round 2: APPROVED — all round-1 findings fixed or re-scoped (#110) (code-review-analyzer)
- [2026-08-23-issue-102-review-ui-second-lane](reviews/2026-08-23-issue-102-review-ui-second-lane.md) — PR #108/#102 review UI second lane: APPROVED (r2, ea1e19a fixed the decided-rows condition; r1 CONDITIONAL) (code-review-analyzer)
- [2026-08-23-issue-103-member-picker-second-lane](reviews/2026-08-23-issue-103-member-picker-second-lane.md) — PR #107/#103 second lane, round 2 (18b2f05): APPROVED — all conditions verified, 4 residual Minors (code-review-analyzer)
- [2026-08-23-issue-102-send-feedback-gemini-round3](reviews/2026-08-23-issue-102-send-feedback-gemini-round3.md) — PR #109/#102 round 3 (1bd761f): APPROVED, all findings resolved (gemini-cli-reviewer)
- [2026-08-23-issue-102-review-ui-gemini](reviews/2026-08-23-issue-102-review-ui-gemini.md) — PR #108/#102 WAQ-011 review UI + campaign feedback: APPROVED, no Critical/Important, 1 Minor (gemini-cli-reviewer)
- [2026-08-23-issue-77-email-queue-gemini](reviews/2026-08-23-issue-77-email-queue-gemini.md) — Issue #77 / PR #106: contact-form email → BullMQ `email-send` queue: APPROVED, no Critical/Important findings, 2 Minor (gemini-cli-reviewer)
- [2026-08-23-issue-103-member-picker-gemini](reviews/2026-08-23-issue-103-member-picker-gemini.md) — PR #107/#103 member picker, round 3: APPROVED (gemini-cli-reviewer)
- [2026-07-28-tpl-009-second-lane](reviews/2026-07-28-tpl-009-second-lane.md) — TPL-009 second lane (grok 402 stand-in): BLOCKED — 2 Critical (post-miss name fallback, multi-WABA cross-tenant write) (code-review-analyzer)
- [2026-07-28-tpl-009-gemini](reviews/2026-07-28-tpl-009-gemini.md) — TPL-009: CONDITIONAL — 3 Critical (cron SYNCABLE_STATUSES trap, name-fallback data bleed, idempotency timestamp gap) (gemini-cli-reviewer)
- [2026-07-17-tpl-004-image-header-upload-gemini-r2](reviews/2026-07-17-tpl-004-image-header-upload-gemini-r2.md) — TPL-004 image-header handle minting, round 2 (gemini-cli-reviewer)
- [2026-07-17-tpl-004-image-header-upload-grok-round2](reviews/2026-07-17-tpl-004-image-header-upload-grok-round2.md) — TPL-004 image-header resumable upload → Meta handle, round 2 (grok-cli-reviewer)
- [2026-07-16-tpl-003-template-meta-submission-gemini](reviews/2026-07-16-tpl-003-template-meta-submission-gemini.md) — TPL-003 template Meta submission & rejection propagation (gemini-cli-reviewer)
- [2026-07-16-tpl-003-template-meta-submission-grok](reviews/2026-07-16-tpl-003-template-meta-submission-grok.md) — TPL-003 template Meta submission, issue #64 (grok-cli-reviewer)
- [2026-07-06-reply-001-review](reviews/2026-07-06-reply-001-review.md) — REPLY-001 per-tenant contact-redirect CTA (code-review-analyzer)

### Tests
- [2026-08-28-tag-001-issues-138-139-acceptance](tests/2026-08-28-tag-001-issues-138-139-acceptance.md) — #138/#139 acceptance: **PASSED WITH GAPS** — 1 blocking (CSV tag feedback, fixed in review round 1), 11 non-blocking; mutation-tested; code-level only, no browser env (qa-engineer)
- [2026-08-24-issue-111-acceptance-verdict](tests/2026-08-24-issue-111-acceptance-verdict.md) — #111 member-detail IDOR: acceptance verdict **PASSED** on AC1–AC6, mutation-tested; 6 non-blocking gaps (qa-engineer)
- [2026-07-28-tpl-009-acceptance](tests/2026-07-28-tpl-009-acceptance.md) — I-1: end-to-end route integration suite + acceptance verdict PASSED (qa-engineer)

### Investigations
- [2026-07-03-campaign-broadcast-qr-instead-of-claim](investigations/2026-07-03-campaign-broadcast-qr-instead-of-claim.md) — Campaign broadcast sends QR eagerly instead of the claim-button flow (bug-hunter) — _status: resolved_

### Artifacts

**TAG-001 / WONB-017 — #138 member tags + #139 import preview (2026-08-28)**
- [2026-08-28-tag-001-review-fix-r1-backend](artifacts/2026-08-28-tag-001-review-fix-r1-backend.md) — review round 1 backend: paginated member_tags read, inner-join tag filter, exact delete count, serialised lookups, batch tagIds asserted pre-write, UUID → 400, 066 drop-by-lookup; gateway probe + scratch replay (senior-backend-dev)
- [2026-08-28-tag-001-review-fix-r1-frontend](artifacts/2026-08-28-tag-001-review-fix-r1-frontend.md) — review round 1 frontend: CSV tag feedback, reachable bulk success line, too_many_new_tags copy, gated fetches, clipboard hygiene, 500-row cap (react-frontend-dev)
- [2026-08-28-tag-001-review-fix-r2-backend](artifacts/2026-08-28-tag-001-review-fix-r2-backend.md) — review round 2 (recovered /code-review finders): claim point query, ordered paging by rows received, PATCH tagIds validation + ownership pre-write, setCampaignTags hardening, single CrossTenantTagError (403), wire-shape checks, chunked batch upsert (senior-backend-dev)
- [2026-08-28-tag-001-b0-i18n-backend](artifacts/2026-08-28-tag-001-b0-i18n-backend.md) — B0: 40 i18n keys both locales + parity test (senior-backend-dev)
- [2026-08-28-tag-001-b1-csv-tags-backend](artifacts/2026-08-28-tag-001-b1-csv-tags-backend.md) — B1: CSV `tags` column parsed/normalised, wire + preview echo, 45 tests (senior-backend-dev)
- [2026-08-28-tag-001-b2-commit-tags-backend](artifacts/2026-08-28-tag-001-b2-commit-tags-backend.md) — B2: RPC 068 upsert_tags_by_name, per-row member_tags after consent fan-out, cap before write, best-effort tagging; scratch-DB proof (senior-backend-dev)
- [2026-08-28-tag-001-b3-bulk-tags-backend](artifacts/2026-08-28-tag-001-b3-bulk-tags-backend.md) — B3: POST /api/dashboard/members/bulk-tags, 26 tests (senior-backend-dev)
- [2026-08-28-tag-001-b4-recipient-count-backend](artifacts/2026-08-28-tag-001-b4-recipient-count-backend.md) — B4: RPC 067 count_active_members_by_tags + recipient-count route + send-path chunking/active filter; scratch-DB proof (senior-backend-dev)
- [2026-08-28-tag-001-b5-preview-lookups-backend](artifacts/2026-08-28-tag-001-b5-preview-lookups-backend.md) — B5: read-only preview member/consent lookups, zero-write asserted, 42 tests (senior-backend-dev)
- [2026-08-28-tag-001-f1-preview-step-frontend](artifacts/2026-08-28-tag-001-f1-preview-step-frontend.md) — F1: rejections panel, AM-4 merge-aware warnings, CSV tag summary, 39 tests (react-frontend-dev)
- [2026-08-28-tag-001-f2-commit-rejections-frontend](artifacts/2026-08-28-tag-001-f2-commit-rejections-frontend.md) — F2: grouped rejections + copy/CSV, tagging warning, 28 tests (react-frontend-dev)
- [2026-08-28-tag-001-f3-campaign-multitag-frontend](artifacts/2026-08-28-tag-001-f3-campaign-multitag-frontend.md) — F3: multi-tag OR picker + debounced live recipient count, 30 tests (react-frontend-dev)
- [2026-08-28-tag-001-f4-bulk-tag-frontend](artifacts/2026-08-28-tag-001-f4-bulk-tag-frontend.md) — F4: members-list selection + bulk tag bar, 40 tests (react-frontend-dev)
- [2026-08-28-tag-001-issues-138-139-orchestrator-handoff](artifacts/2026-08-28-tag-001-issues-138-139-orchestrator-handoff.md) — orchestrator checkpoint: PR #51 merged with develop (7c05d63), migrations 065/066 scratch-validated, decisions, next steps (claude)

**WONB-018 / WONB-019 — #148 CSV column-shift bug + #147 import template**
- [2026-08-28-wonb-018-tokenizer-backend](artifacts/2026-08-28-wonb-018-tokenizer-backend.md) — A1: RFC 4180 tokeniser + parseCsv rejection, 152 tests (senior-backend-dev)

**Issue #111 — member-detail cross-tenant IDOR**
- [2026-08-24-issue-111-b1-scoped-repository-backend](artifacts/2026-08-24-issue-111-b1-scoped-repository-backend.md) — B-1 scoped repo, 8/8 tests
- [2026-08-24-issue-111-b2-get-detail-route-backend](artifacts/2026-08-24-issue-111-b2-get-detail-route-backend.md) — B-2 GET detail route threads restaurantId, 16/16 tests (senior-backend-dev)
- [2026-08-24-issue-111-b3-delete-route-backend](artifacts/2026-08-24-issue-111-b3-delete-route-backend.md) — B-3 DELETE route fetch-then-compare removed, 8/8 tests (senior-backend-dev)
- [2026-08-24-issue-111-i1-integration-verification-backend](artifacts/2026-08-24-issue-111-i1-integration-verification-backend.md) — I-1: full suite 3593 passed, live cross-tenant probe 404/no-PII, browser walk, journal + kanban SEC-004 done (senior-backend-dev)

**WAQ-014 — gate error diagnosability (#117)**
- [2026-08-24-waq-014-gate-error-backend](artifacts/2026-08-24-waq-014-gate-error-backend.md) — trustReason now rendered into the blocked-send message; 2 files, 10/10 tests, full suite green (senior-backend-dev)

**TPL-009 — template status sync (#93)**
- [2026-07-28-tpl-009-template-status-sync-backend-t2](artifacts/2026-07-28-tpl-009-template-status-sync-backend-t2.md) — T2: webhook classification + template-status extractor (senior-backend-dev)
- [2026-07-28-tpl-009-template-status-sync-backend-t3](artifacts/2026-07-28-tpl-009-template-status-sync-backend-t3.md) — T3: WABA tenant-resolution rung, new resolve-tenant.test.ts (deviates from the plan's stated test filename — see artifact) (senior-backend-dev)
- [2026-07-28-tpl-009-template-status-sync-backend-t5](artifacts/2026-07-28-tpl-009-template-status-sync-backend-t5.md) — T5: webhook handler + route wiring (senior-backend-dev)
- [2026-07-28-tpl-009-template-status-sync-backend-t6](artifacts/2026-07-28-tpl-009-template-status-sync-backend-t6.md) — T6: Forge scheduling script + README docs (senior-backend-dev)

**REPLY-007 — per-tenant contact Flow**
- [2026-07-26-reply-007-config-storage-backend](artifacts/2026-07-26-reply-007-config-storage-backend.md) — Stream A: per-tenant labels + flow-id storage (senior-backend-dev)
- [2026-07-26-reply-007-flow-json-labels-backend](artifacts/2026-07-26-reply-007-flow-json-labels-backend.md) — Stream B1: Flow JSON v2 label bindings + contract test guard (senior-backend-dev)
- [2026-07-26-reply-007-deploy-machinery-backend](artifacts/2026-07-26-reply-007-deploy-machinery-backend.md) — Stream B2: flow-client + ensureContactFlowDeployed (senior-backend-dev)
- [2026-07-26-reply-007-deploy-script-rework-backend](artifacts/2026-07-26-reply-007-deploy-script-rework-backend.md) — Stream B3: deploy-contact-flow.ts reworked to per-tenant + --force (senior-backend-dev)
- [2026-07-26-reply-007-send-path-backend](artifacts/2026-07-26-reply-007-send-path-backend.md) — Stream C1: send path — per-tenant flow id + label injection (senior-backend-dev)
- [2026-07-26-reply-007-patch-route-deploy-hook-backend](artifacts/2026-07-26-reply-007-patch-route-deploy-hook-backend.md) — Stream D1: contact-config PATCH route deploy hook (senior-backend-dev)
- [2026-07-26-reply-007-admin-ui-frontend](artifacts/2026-07-26-reply-007-admin-ui-frontend.md) — Stream D2: admin UI — per-tenant form labels + deploy-failure warning (react-frontend-dev)
- [2026-07-26-reply-007-review-fixes-backend](artifacts/2026-07-26-reply-007-review-fixes-backend.md) — Code-review fix pass (M3, L7, L4, L1, M4) (senior-backend-dev)
- [2026-07-26-reply-007-high-findings-fix-backend](artifacts/2026-07-26-reply-007-high-findings-fix-backend.md) — Code-review fix pass (H3, H1, H2, M1, M2) (senior-backend-dev)
- [2026-07-26-reply-007-flow-name-collision-fix-backend](artifacts/2026-07-26-reply-007-flow-name-collision-fix-backend.md) — CodeRabbit Critical: WhatsApp Flow name collision (PR #72) (senior-backend-dev)
- [2026-07-26-reply-007-waba-resolution-dry-fix-backend](artifacts/2026-07-26-reply-007-waba-resolution-dry-fix-backend.md) — WABA resolution DRY fix, derive-first de-duplication (senior-backend-dev)

**REPLY-005 — contact-us mode**
- [2026-07-26-reply-005-contact-config-backend](artifacts/2026-07-26-reply-005-contact-config-backend.md) — Stream A: config foundation (senior-backend-dev)
- [2026-07-26-reply-005-flow-send-backend](artifacts/2026-07-26-reply-005-flow-send-backend.md) — Stream B1: sendInteractiveFlow wired through the messaging port (senior-backend-dev)
- [2026-07-26-reply-005-flow-deploy-backend](artifacts/2026-07-26-reply-005-flow-deploy-backend.md) — Stream B2: Flow JSON asset + deploy script (senior-backend-dev)
- [2026-07-26-reply-005-email-backend](artifacts/2026-07-26-reply-005-email-backend.md) — Stream C: email capability (senior-backend-dev)
- [2026-07-26-reply-005-webhook-parser-flow-backend](artifacts/2026-07-26-reply-005-webhook-parser-flow-backend.md) — Stream D1: webhook-parser nfm_reply carrier (senior-backend-dev)
- [2026-07-26-reply-005-webhook-dispatch-backend](artifacts/2026-07-26-reply-005-webhook-dispatch-backend.md) — Stream D2: contact-form submission handler + webhook dispatch (senior-backend-dev)
- [2026-07-26-reply-005-contact-mode-branch-backend](artifacts/2026-07-26-reply-005-contact-mode-branch-backend.md) — Stream D3: contact-handler mode branch + Flow id resolver (senior-backend-dev)
- [2026-07-26-reply-005-contact-config-route-backend](artifacts/2026-07-26-reply-005-contact-config-route-backend.md) — Stream E1: PATCH /api/dashboard/settings/contact-config (senior-backend-dev)
- [2026-07-26-reply-005-contact-admin-ui-frontend](artifacts/2026-07-26-reply-005-contact-admin-ui-frontend.md) — Stream E2: admin UI — contact mode picker + form settings (react-frontend-dev)
- [2026-07-26-reply-005-review-fixes-backend](artifacts/2026-07-26-reply-005-review-fixes-backend.md) — CONDITIONAL review fixes, backend (senior-backend-dev)
- [2026-07-26-reply-005-review-fixes-frontend](artifacts/2026-07-26-reply-005-review-fixes-frontend.md) — CONDITIONAL review fixes, frontend (M1, M2) (react-frontend-dev)
- [2026-07-26-reply-005-coderabbit-fixes-backend](artifacts/2026-07-26-reply-005-coderabbit-fixes-backend.md) — CodeRabbit review fixes, PR #70 (senior-backend-dev)
- [2026-07-26-reply-005-coderabbit-fixes-frontend](artifacts/2026-07-26-reply-005-coderabbit-fixes-frontend.md) — CodeRabbit UI findings #1, #2, PR #70 (react-frontend-dev)

**CAMP-009 — #136/#134 create auto-send + marketing-only broadcast**
- [2026-08-28-camp-009-release-runbook](deploys/2026-08-28-camp-009-release-runbook.md) — release d4d7839 / build K_BSezxKjjMOgGpOtU8Pp, worktree-build notes, bundle verification (claude)
- [2026-08-28-camp-009-create-autosend-and-marketing-only-broadcast](plans/2026-08-28-camp-009-create-autosend-and-marketing-only-broadcast.md) — plan: Streams A (#136) + B (#134), ACs, risk (claude)
- [2026-08-28-camp-009-stream-a-create-autosend-frontend](artifacts/2026-08-28-camp-009-stream-a-create-autosend-frontend.md) — Stream A: auto-execute deleted, submitCampaign pinned, label rename (react-frontend-dev)
- [2026-08-28-camp-009-stream-b-marketing-only-broadcast-backend](artifacts/2026-08-28-camp-009-stream-b-marketing-only-broadcast-backend.md) — Stream B: marketing-only send path, no mint/QR (senior-backend-dev)
- [2026-08-28-camp-009-stream-c-coupon-param-preflight-backend](artifacts/2026-08-28-camp-009-stream-c-coupon-param-preflight-backend.md) — Stream C: review I-1 — enforceCouponParams preflight, route + worker (senior-backend-dev)
- [2026-08-28-camp-009-round-2-code-review-fixes-backend](artifacts/2026-08-28-camp-009-round-2-code-review-fixes-backend.md) — Round 2: /code-review PR #140 — gate invariant widened (discount, COPY_CODE, inline, claim), prefetch skip, DRY tail (senior-backend-dev)

**CAMP-008 — #131/#132 outbound status + claim-mode button**
- [2026-08-27-camp-008-outbound-status-and-claim-button](plans/2026-08-27-camp-008-outbound-status-and-claim-button.md) — plan D1–D6 + advisor amendment A1–A9 (claude)
- [2026-08-27-camp-008-stream-a-webhooks-v2-backend](artifacts/2026-08-27-camp-008-stream-a-webhooks-v2-backend.md) — Stream A: Kapso v2 outbound status classification + real 131042 fixture (senior-backend-dev)
- [2026-08-27-camp-008-stream-bc-failure-reconcile-rerun-backend](artifacts/2026-08-27-camp-008-stream-bc-failure-reconcile-rerun-backend.md) — Streams B+C: tracking opt-out, retract RPC 064, finalize CAS, re-run ledger + coupon reuse (claude)
- Stream D (#132 QUICK_REPLY) ships on its own branch/PR #133 — artifact lives there

**Earlier**
- [2026-07-16-tpl-003-template-meta-submission-backend](artifacts/2026-07-16-tpl-003-template-meta-submission-backend.md) — TPL-003 template Meta submission (B1 + B4 + B5 + B6) (senior-backend-dev)
- [2026-06-10-stamp-collection-backend](artifacts/2026-06-10-stamp-collection-backend.md) — Stamp Collection Phase B: granting loop (senior-backend-dev)
- [2026-06-10-stamp-collection-phase-c-backend](artifacts/2026-06-10-stamp-collection-phase-c-backend.md) — Phase C: owner CRUD + cap policy + enrollment token (senior-backend-dev)
- [2026-06-10-stamp-collection-phase-d-backend](artifacts/2026-06-10-stamp-collection-phase-d-backend.md) — Phase D: Slice-2 backend (senior-backend-dev)
- [2026-06-10-dev-whatsapp-mocks-backend](artifacts/2026-06-10-dev-whatsapp-mocks-backend.md) — Dev-only WhatsApp mock utilities (senior-backend-dev)
- [2026-06-07-stamp-collection-pricing-gtm](artifacts/2026-06-07-stamp-collection-pricing-gtm.md) — Stamp Collection pricing & go-to-market (product-manager)
- [2026-06-07-hk-loyalty-competitive-analysis](artifacts/2026-06-07-hk-loyalty-competitive-analysis.md) — HK loyalty / stamp-card competitive analysis, market sizing & pricing (deep-research)

## Superseded

- [2026-08-23-issue-102-send-feedback-gemini-round2](reviews/2026-08-23-issue-102-send-feedback-gemini-round2.md) — superseded by the round-3 Gemini review
- [2026-08-23-issue-102-send-feedback-gemini](reviews/2026-08-23-issue-102-send-feedback-gemini.md) — superseded by the round-2 Gemini review
- [2026-07-17-tpl-004-image-header-upload-gemini](reviews/2026-07-17-tpl-004-image-header-upload-gemini.md) — superseded by the round-2 Gemini review
- [2026-07-17-tpl-004-image-header-upload-grok](reviews/2026-07-17-tpl-004-image-header-upload-grok.md) — superseded by the round-2 Grok review
- [2026-06-09-stamp-collection-implementation](plans/2026-06-09-stamp-collection-implementation.md) — superseded by the build-ready plan

## Archived
(none)
