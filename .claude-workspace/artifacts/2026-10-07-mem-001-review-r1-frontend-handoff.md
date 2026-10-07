---
id: artifacts/2026-10-07-mem-001-review-r1-frontend-handoff
type: artifact
author: react-frontend-dev
created: 2026-10-07
status: active
supersedes: null
superseded_by: null
related: [artifacts/2026-10-07-mem-001-review-r1-backend-handoff]
---
# MEM-001 review r1 frontend handoff
Stage: POC. Items F0-F5 done; acceptance suite: none frozen (POC).
- F0 `useMembers({includeQuality})` default off -> `include=quality`; only members page passes true (picker uses its own fetch client, unchanged).
- F1 `buildQualityTooltip` (member-detail-helpers) + new key `qualityUnreachableTooltip` en/zh-HK.
- F2 `clampPage` + `refetchAndClamp` in page; `refetch` now resolves the fresh response.
- F3 pageSize in bulk-bar key. F5 comment 250.
- F4 single sources: ContactQuality, `import type MemberQualityEvidence` (erased, no server code in bundle), UNKNOWN_CONTACT_QUALITY, NO_TAG_FILTER in lib/constants (repository re-export removed; route imports constants), `formatDate` moved to member-detail-helpers (panel + section use it; panel-parts/others untouched).
- Tests: member-quality-tooltip.test.ts (tooltip per reason, clampPage, include param). Dashboard+messages+members route+hooks: 661 pass.
- Pre-existing, not mine: member-tag-filter.test.tsx 5 failures at base 53cf43c9 (test calls MemberTagFilter() and reads root props; root is now a div). Eslint set-state-in-effect on use-members.ts:89 and member-detail-panel.tsx:146 pre-existing.
- tsc clean after removing stale harness entries from .next/dev/types.
- Evidence: .claude-workspace/artifacts/2026-10-07-mem-001-screens/table-unreachable-tooltip-and-panel-yellow.png (mocked harness, deleted; native title tooltips don't render headless, so the harness prints each badge's title text under the table). Locale zh-HK.
