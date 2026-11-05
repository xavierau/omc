---
id: artifacts/2026-10-07-mem-001b-frontend-handoff
type: handoff
contract: handoff-file-v1
author: react-frontend-dev
created: 2026-10-07
status: active
item: MEM-001
state: done
brief: inline
base: 2b08b60d
head: HEAD
branch: feature/mem-001-members-table
pushed: false
stage: poc
gate: {result: none, at: none}
next: {owner: none, action: none}
blockers: []
refs: [artifacts/2026-10-07-mem-001b-backend-handoff, artifacts/2026-10-07-mem-001-frontend-handoff]
---
ac:
  AC-1: {result: pass, evidence: "screens/panel-yellow|panel-red-unreachable|panel-no-data|panel-unavailable.png in .claude-workspace/artifacts/2026-10-07-mem-001-screens/ (zh-HK; verdict sentences read from the DOM snapshot)"}
  AC-2: {result: pass, evidence: "screens/table-250-no-tag.png + table-250-no-tag-pagination.png: 250/page, No tag active (200 untagged of 600 mocked), quality column visible"}
  AC-3: {result: pass, evidence: "locale-parity.test.ts + member-quality-verdict.test.ts (6) + member-detail-helpers.test.ts: 12 passed"}
  AC-4: {result: pass, evidence: "tsc --noEmit under heavy lock: no output (clean). eslint 4 touched files: only pre-existing react-hooks/set-state-in-effect at member-detail-panel.tsx:150 (fetchMember effect, untouched). Committed, not pushed; CLAUDE.md not committed."}
failed: []
invariants:
  - "Window and thresholds quoted from payload (windowDays, thresholds); none hardcoded in the UI"
  - "No message text rendered"
decisions:
  - "Verdict builder is a pure helper (buildQualityVerdict) in member-detail-helpers.ts returning an i18n key + values; unit-tested."
  - "Badge gets optional testId prop so the panel badge does not duplicate the row testid; extra testid member-quality-evidence-badge (registered)."
  - "null evidence renders only the muted line, no heading."
unverified:
  - "Real API payload (080 not applied on DEV); walk used a temporary fetch-mocked harness route (deleted)"
  - "en locale and mobile width not viewed; panel screenshots show the top of the section, message list below the fold in the viewport"
  - "Dates use en-HK format regardless of locale (matches existing panel formatDate)"
review_focus:
  - "member-quality-evidence-section.tsx: t(key as never) casts for dynamic i18n keys"
scope_drift:
  - "none; screenshots saved via main-repo path then moved (devtools MCP only writes under the primary root)"
next_step: "Review diff; real-login pass once creds and migration 080 exist."
---
