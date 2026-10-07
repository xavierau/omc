---
id: artifacts/2026-10-07-mem-001-review-r1-frontend-handoff
type: handoff
contract: handoff-file-v1
author: react-frontend-dev
created: 2026-10-07
status: active
item: MEM-001
state: done
brief: inline
base: 53cf43c9
head: c150c404
branch: feature/mem-001-members-table
pushed: false
gate: {result: none, at: none}
next: {owner: none, action: none}
blockers: []
refs: [artifacts/2026-10-07-mem-001-review-r1-backend-handoff]
---
ac:
  AC-1: "pass - buildMembersQuery test; only members page passes includeQuality"
  AC-2: "pass - 661 tests green incl. locale parity; 5 member-tag-filter failures pre-exist at base"
  AC-3: "pass - grep shows one definition each; no fmtDate copy"
  AC-4: "pass - artifacts/2026-10-07-mem-001-screens/table-unreachable-tooltip-and-panel-yellow.png"
  AC-5: "pass - tsc clean, eslint only pre-existing, committed not pushed"
decisions:
  - "Clamp lives in the page handler: refetch now resolves the fresh response, then clampPage sets page"
  - "formatDate moved to member-detail-helpers to avoid a panel/section import cycle"
  - "QualityEvidence replaced by import type MemberQualityEvidence (erased, no server code in the bundle)"
  - "NO_TAG_FILTER repository re-export removed; route imports from lib/constants"
failed: []
invariants:
  - "useMembers sends include=quality only when includeQuality is true (default off)"
  - "Unreachable tooltip never quotes a delivery rate"
unverified:
  - "Native title tooltip hover not captured headless; harness printed the title text instead"
  - "Bulk-tag page clamp not exercised in a real browser"
review_focus:
  - "refetchAndClamp in members page.tsx triggers a second fetch via setPage"
scope_drift:
  - "member-table.tsx edited (type import ContactQuality) - outside files_allowed"
  - "CLAUDE.md dirty, left uncommitted"
next_step: "Fix the 5 pre-existing member-tag-filter test failures before merging PR 171."
