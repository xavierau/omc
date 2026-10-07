---
id: artifacts/2026-09-09-solution-architect-handoff
type: handoff
author: solution-architect
created: 2026-09-09
status: final
related: [plans/2026-09-09-tpl-011-video-template-header, kanban:TPL-011]
---

# Handoff: solution-architect — TPL-011 plan

## Current state
Plan delivered and final: `plans/2026-09-09-tpl-011-video-template-header`. Kanban entry
TPL-011 added (in_progress, branch `feature/tpl-011`). INDEX.md line added. Worktree:
`/Users/xavierau/Code/js/whatsapp-crm-tpl-011-worktree`. Nothing committed; no code written.

## Decisions + rationale
- Rename `headerImageUrl → headerMediaUrl` (single slot, format is the discriminator; no test references the old name).
- Sibling `VideoUploader` rather than parameterising `ImageUploader` (four callers untouched); pure helpers for size pre-check + non-JSON 413 handling.
- Per-bucket policy in a pure `upload-policy.ts` (video only on `wa-template-media`, 16 MB; images 5 MB everywhere).
- Type-switch clears the URL via `applyWaTemplateFormChange` (dialog delegates).
- Wording media-neutral, error codes unchanged; two existing string assertions must be updated (listed in plan).

## In flight / next step
Dispatch Stream A (senior-backend-dev) and Stream B (react-frontend-dev) in parallel from the plan; I-1 after both. Kapso video ingest verified only by A-6 probe / I-2 prod verify. Deploy precondition: nginx body limit artifact from devops.

## Tried and rejected
- Separate `headerVideoUrl` field: doubles clear/round-trip branches for no domain reason.
- Adding `accept`/preview props to `ImageUploader`: touches a shared component used by four callers for one consumer.
