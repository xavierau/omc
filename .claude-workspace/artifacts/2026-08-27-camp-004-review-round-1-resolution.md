---
id: artifacts/2026-08-27-camp-004-review-round-1-resolution
type: artifact
author: claude
created: 2026-08-28
status: active
supersedes: null
superseded_by: null
related: [kanban:CAMP-004, github:132, github:133, reviews/2026-08-27-camp-004-quick-reply-gemini, reviews/2026-08-27-camp-004-quick-reply-analyzer]
---

# PR #133 (#132) — review round 1 resolution (commit 4e314cc)

Merge verdict, worst-of: gemini **APPROVED** · analyzer **CONDITIONAL** (1 Important, 6 Minor) · `/code-review 133 high` partial (2 of 8 finder angles completed before the session limit; findings below).

| Source | Finding | Resolution |
|---|---|---|
| analyzer I1 | No debugging journal for a `fix:` commit | Added `debugging_journals/2026-08-27-claim-mode-unreachable-quick-reply.md` |
| analyzer M1 / code-review A4 | UNSUPPORTED without `raw` → `null` on the wire | Builder falls back to `{ type: 'UNSUPPORTED', text }`; test pins it |
| analyzer M3 | Remove on UNSUPPORTED row never invoked | Test now clicks it and asserts `onChange('buttons', [])` |
| analyzer M4 | Untouched PHONE/URL rows unpinned after `ButtonRow` restructure | Test pins their input placeholders; QUICK_REPLY case asserts exact inputs |
| analyzer M5 | Hints located by substring | `data-testid` on both hints; tests select on them |
| code-review A1 | `COUPON_URL` + `QUICK_REPLY` — claim mode has no code for `{{1}}` → every send fails | `validateWaTemplateButtons` refuses the combination |
| code-review A2 | Hint undersells that a quick reply flips the campaign into claim mode | Hint reworded |
| code-review A3 | Quick replies interleaved with CTA buttons (Meta grouping rule; edit path deletes the live template first) | Validation refuses non-contiguous groups |
| code-review A5, A6, A7 | `/coupon/` substring detection, URL `example` dropped on round-trip, server label rule for unknown types | **Pre-existing, not introduced by #132 — left out** (noted for the CAMP-004 follow-up) |
| analyzer M2, M6; simplify S1–S7 | UNSUPPORTED branch duplication, discriminated-union refactor, parseButtons literal repetition, shared render-tree helper | Not applied — refactors beyond the hotfix's surgical scope; discriminated union is the right shape when CAMP-004 lands |

Verification after fixes: `vitest run src/components/dashboard` → 31 files / 334 tests green; `tsc --noEmit` clean; `eslint` clean on the four touched files.
