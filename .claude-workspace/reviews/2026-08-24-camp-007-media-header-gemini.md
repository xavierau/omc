---
id: reviews/2026-08-24-camp-007-media-header-gemini
type: review
author: gemini-cli-reviewer
reviewer_model: gemini-cli
created: 2026-08-24
status: active
supersedes: null
superseded_by: null
related: [plans/2026-08-24-camp-007-media-header-send, kanban:CAMP-007, github:#127]
---

# Code Review (Gemini CLI): CAMP-007 — Campaign send omits media header component (#127, P1)

## Summary
The PR successfully addresses CAMP-007 by properly handling media headers in WhatsApp templates. It introduces a discriminated union for header parameters, adds a robust fail-fast validation mechanism (`enforceHeaderMedia`) across orchestration, API, and send layers, and safely handles all-failed campaign runs by transitioning them to a `failed` state with a tenant-visible reason instead of erroneously marking them `completed`.

## 🔴 Critical (Must Fix)
None.

## 🟡 Important (Should Fix)
- **Missing Integration Map**: There is no Integration Map in the plan document. As noted, this was an autonomous bug-fix run so it was bypassed, but it is important to explicitly document the three gate call sites (`execute-campaign.ts`, `route.ts`, `send-template-message.ts`) in the PR description or plan to ensure future maintainers know to keep them in sync.

## 🟢 Minor (Optional)
- `src/application/enforce-header-media.ts`: The error message inside `TemplateHeaderMediaMissingError` is a hardcoded string. Although it fulfills its requirement to be tenant-visible and safe to store in the DB, consider utilizing the standard i18n localization strategy in the future if this error surface expands.

## ✅ Strengths
- Excellent application of DDD principles using a discriminated union (`TemplateHeaderParam`) to enforce the correctness of outbound payloads at the type level.
- Solid defense-in-depth placement of the `enforceHeaderMedia` gate. It correctly fails fast at the sync API and orchestrator layers, while serving as a final fail-safe deep in the `sendWhatsAppTemplateMessage` core.
- O(1) fail-fast checking at the orchestration boundary prevents costly processing and DB operations for deterministically invalid templates.
- Explicit and clear logging of tenant-actionable errors (`isTenantMeaningfulError`) without leaking raw Kapso/Meta API internal details.
- Elegant resolution for all-failed runs (`sent === 0 && failed > 0`) in `finalizeCampaignRun` that aligns perfectly with business requirements for exposing deterministic send-failures.

## Open Questions
None.

## Verdict: APPROVED
