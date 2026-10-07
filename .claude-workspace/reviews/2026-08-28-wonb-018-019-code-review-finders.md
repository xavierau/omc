---
id: reviews/2026-08-28-wonb-018-019-code-review-finders
type: review
author: claude
created: 2026-08-28
status: active
supersedes: null
superseded_by: null
related: [kanban:WONB-018, kanban:WONB-019, github:148, github:147, github:149, github:150, github:151, plans/2026-08-28-wonb-018-019-csv-parser-and-template, reviews/2026-08-28-wonb-018-019-gemini, reviews/2026-08-28-wonb-018-019-grok]
---

# `/code-review 149 high` — recovered finder set and dispositions

## What happened
`/code-review 149 high` ran as a forked background agent, spawned four finders (A-linescan,
B-removed, C-crossfile, D-pitfalls) and then stalled ("no progress for 600 s", harness-killed) before
its verification pass — the same failure mode as memory `incident_code_review_fork_orphaned_finders`
(PR #140). Per that memory the finders' final JSON arrays were harvested from
`subagents/agent-afinder-*.jsonl` and verified by hand; the skill was **not** re-run.
Finder **B (removed code / regressions)** died on `ECONNRESET` with no output; finder C's call-site
trace ("every call site of the changed symbols is updated; nothing else imported `MAX_ROWS` or the
old `rows` prop; `preview-contacts-batch-lookups.ts` does not import `parse-csv.ts`") covers most of
that angle. Residual gap: no independent pass over *deleted* lines beyond the diff read by A/C/D.

## Findings (deduplicated across A/C/D) and dispositions — all fixes in commit after `b13ad4d`

| # | Finding (file:line at `b13ad4d`) | Source | Disposition |
|---|---|---|---|
| 1 | `parse-csv.ts:120` `buildReject` copies the raw phone cell; an unterminated quote opened in the phone column puts the rest of the file (MBs) into `reject.phone`, rendered inline by the panel | A, D | **Fixed** — `rejectPhone()` returns `null` for any value with a line break or > 32 chars (T-A2.19/20) |
| 2 | `step-upload-csv.tsx:64` file input value never reset → Chrome fires no `change` when the same (fixed) file is re-picked; the new panel makes fix-and-re-upload the primary recovery loop | A, D | **Fixed** — `e.target.value = ''` in `onChange` (test: "resets the file input…") |
| 3 | `parse-csv.ts:68` `matchHeader` ran before the header-`unterminated` check, so `"phone,name…` reported "empty / missing phone column" instead of the line-1 quote (T-A2.16 had pinned the wrong behaviour) | A, D | **Fixed** — unterminated header checked first; T-A2.16 rewritten |
| 4 | `parse-csv.ts:127/124` a quoted cell's embedded newline now survives into `members.name` (later a WhatsApp template parameter — Meta rejects newlines) and into a tag name (junk-tag class via a new vector); impossible on base (split on `\r?\n`) | C, D | **Fixed** — name: whitespace runs collapsed to one space (T-A2.17); tags: line breaks act as `;` (T-A2.18) |
| 5 | `en.json:949` / zh-HK `column_count_mismatch` hint ("check for a comma … not wrapped in quotes") only fits `actual > expected`; for short rows it points at a comma that doesn't exist | A, C | **Fixed** — ICU `select` on a `direction` param the panel derives (`more` / `fewer`); T-A3.2 updated |
| 6 | `step-upload-csv.tsx:28` `await file.text()` can reject (NotReadableError); unhandled → previous parse stays on screen | A | **Fixed** — `readFileText()` try/catch → new `csv.errors.unreadable` (en + zh-HK) + `onParsed(EMPTY_CSV)`; test added |
| 7 | `csv-tokenizer.ts:63` only ASCII space/tab skipped before an opening quote; U+3000 / NBSP (HK IME, zh-HK Excel) makes the quote literal → misleading "wrap it in quotes" rejection | A, D (low) | **Fixed** — `isLeadingBlank()` also skips NBSP and U+3000 (T-A1.15) |
| 8 | `en.json` `rejectedTitle` renders "1 rows" | D (cosmetic) | **Fixed** — ICU plural in en; zh-HK has no plural |
| 9 | `step-upload-csv.tsx:28` `File.text()` is UTF-8-only; Big5 CSVs from HK Windows Excel import Chinese names as mojibake past every check | D | **Deferred** → issue **#151** (pre-existing decode; plan non-goal "encodings other than UTF-8") |
| 10 | `parse-csv.ts:106` short rows (`cells.length < expected`) are now rejected where base tolerated them — stricter than the bug strictly requires; hand-maintained phone+name files under a 4-column header will show rejections | C | **Kept as designed** (plan AD-2). A short row *can* hide a shift — `+852…,Chan, Tai Man` under 4 headers is 3 cells with the name truncated to `Chan` — so tolerance would re-open #148 by another door. The hint fix (#5) tells the operator exactly what to add; the template + help text document the contract. Called out in the PR "Notes for the release". |

Split for size: cell-level helpers moved to `parse-csv-cells.ts` (parse-csv.ts 140 lines).

## Cleared by the finders (no finding)
Perf ~40 ms per 50k rows in Node (budget headroom ~50×); surrogate pairs round-trip; BOM emitted once
in the template Blob; `charCodeAt` bounds guarded; `'0'` phone kept; `EMPTY_CSV` never mutated;
`useCallback` deps correct; no ICU-special characters in the original strings; `download-csv.ts`
matches the three pre-existing copies; a quoted phone `"+852 9123 4567"` survives because
`PhoneNumber.create` strips whitespace; both `csv.reason.*` keys present in both locales;
`{maxRows, number}` renders `50,000` under the next-intl v4 provider.

## Verification after fixes
Scoped suite 27 files / 191 tests green; `tsc --noEmit` clean; eslint clean; full suite result
recorded in the PR body. The earlier browser walk (`tests/2026-08-28-wonb-018-019-ui-verification`)
predates fixes #2/#5/#6/#8; those are unit-pinned and not re-walked — stated in the PR.
