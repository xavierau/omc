# Workspace Index

_Last updated: 2026-07-28 — rebuilt by scanning the artifact frontmatter on disk after the
previous index was accidentally overwritten by a worktree-local index. Descriptions are
derived from each file's title/frontmatter, so wording may differ from the original entries;
no artifact files were lost._

## Active

### Specs
- [2026-06-07-stamp-collection-campaign](specs/2026-06-07-stamp-collection-campaign.md) — PRD: Stamp Collection Campaign ("Digital Stamp Card") (product-manager)

### Plans
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

### Reviews
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
- [2026-07-28-tpl-009-acceptance](tests/2026-07-28-tpl-009-acceptance.md) — I-1: end-to-end route integration suite + acceptance verdict PASSED (qa-engineer)

### Investigations
- [2026-07-03-campaign-broadcast-qr-instead-of-claim](investigations/2026-07-03-campaign-broadcast-qr-instead-of-claim.md) — Campaign broadcast sends QR eagerly instead of the claim-button flow (bug-hunter) — _status: resolved_

### Artifacts

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
