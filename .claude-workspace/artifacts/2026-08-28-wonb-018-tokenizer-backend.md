---
id: artifacts/2026-08-28-wonb-018-tokenizer-backend
type: artifact
author: senior-backend-dev
created: 2026-08-28
status: active
supersedes: null
superseded_by: null
related: [kanban:WONB-018, github:148, plans/2026-08-28-wonb-018-019-csv-parser-and-template]
---

# WONB-018 A1 — RFC 4180 CSV tokeniser + `parseCsv` rejection + upload-step outcome helper

Work item **A1** of `plans/2026-08-28-wonb-018-019-csv-parser-and-template`. Fixes the #148 bare-comma
column-shift bug at the source: a hand-rolled RFC 4180 tokeniser replaces `line.split(',')`.

## Files Changed

| File | Lines | Purpose |
|---|---|---|
| `src/components/dashboard/import-wizard/csv-tokenizer.ts` | 120 (NEW) | RFC 4180 state machine, zero imports, `tokenizeCsv(text): CsvRecord[]` |
| `src/components/dashboard/import-wizard/parse-csv.ts` | 142 (MOD, was 70) | New header comment (AD-6), uses `tokenizeCsv`, returns `ParseCsvResult` with `rejected[]` |
| `src/components/dashboard/import-wizard/step-upload-csv-helpers.ts` | 22 (NEW) | `MAX_ROWS` (moved), `classifyParseResult` |
| `src/components/dashboard/import-wizard/step-upload-csv.tsx` | 96 (MOD, was 98) | Minimal wiring: `classifyParseResult(parseCsv(text), MAX_ROWS)`; `onParsed(rows: ParsedRow[])` unchanged, no new UI |
| `__tests__/csv-tokenizer.test.ts` | NEW | T-A1.1–T-A1.14 + T-A1.perf (15 tests) |
| `__tests__/parse-csv.test.ts` | MOD | 12 pre-existing cases migrated to `.rows` (kept, unchanged assertions) + T-A2.1–T-A2.14 (26 tests total) |
| `__tests__/step-upload-csv-helpers.test.ts` | NEW | T-A4.1–T-A4.5 (5 tests) |
| `__tests__/step-upload-csv-tag-feedback.test.ts` | MOD, 1 line | `parseCsv(...).rows` |

## Final Exported Signatures

```ts
// csv-tokenizer.ts (zero imports)
export interface CsvRecord { line: number; cells: string[]; unterminated: boolean }
export function tokenizeCsv(text: string): CsvRecord[]

// parse-csv.ts
export interface ParsedRow { phoneE164: string; name: string | null; preferredLanguage: 'en' | 'zh_hk' | null; tags: string[]; ignoredTagCount: number } // unchanged
export type CsvParseRejectReason = 'column_count_mismatch' | 'unterminated_quote'
export interface CsvParseReject { line: number; reason: CsvParseRejectReason; expected: number; actual: number; phone: string | null }
export interface ParseCsvResult { phoneHeaderFound: boolean; rows: ParsedRow[]; rejected: CsvParseReject[] }
export function parseCsv(text: string): ParseCsvResult

// step-upload-csv-helpers.ts
export const MAX_ROWS = 50_000
export type UploadOutcome = { kind: 'error'; error: 'empty' | 'tooManyRows' } | { kind: 'ok'; result: ParseCsvResult }
export function classifyParseResult(result: ParseCsvResult, maxRows: number): UploadOutcome
```

## Key Decisions

- **Tokeniser state machine**: single mutable `State` object threaded through small step functions
  (`stepUnquoted`, `stepQuoted`, `closeOrEscapeQuote`, `endRecordAt`, `finalizeAtEof`, `pushCell`,
  `emitRecord`, `isCharAt`) rather than one large function, to keep every function ≤20 lines while
  staying at exactly 120 total lines (plan's stated ≤120 target, well under the ≤150 hard limit).
  Verified by hand-tracing all 14 Appendix C fixtures against the design before writing code — all 15
  tokeniser tests (14 fixtures + perf) passed on the first implementation attempt, no red-loop churn.
- **Blank-line detection** tracks `lastCellWasQuoted` (captured in `pushCell` before the per-cell flag
  resets) so `emitRecord` can apply the plan's exact rule (`cells.length===1 && !quotedCell && cells[0]
  trim()===''`) without re-deriving it after the reset.
- **`parseCsv` restructured around `classifyRecord` returning a 3-outcome union** (`row` / `reject` /
  `skip`) instead of mutating two arrays via a 5-parameter helper — keeps every function within the
  ≤4-param budget and reads as one decision per record.
- **EOF flush condition** `s.cellStarted || s.cells.length > 0` (not just `cellStarted`) — needed so a
  file ending mid-record on a trailing empty field after a comma (e.g. `1,,` with no trailing newline)
  still emits its final empty cell (T-A1.8's second row). Traced by hand against Appendix C's literal
  wording ("current record has any content or more than one cell").
- **`buildReject`'s `phone` field** reuses `cellOrNull` on `record.cells[idxPhone]` — `undefined` (record
  shorter than the phone index) and `''`/whitespace-only both collapse to `null` per AD-6/T-A2.13, one
  code path for both sub-cases the plan describes.

## Tests

- Baseline (before this task): 17 files / 118 tests, all green.
- After: 19 files / 152 tests, all green — net +34 (15 tokeniser + 14 new parse-csv rejection cases + 5
  helper cases; the 12 pre-existing `parse-csv` cases were migrated to `.rows`, not duplicated).
- `tsc --noEmit -p tsconfig.json`: clean, no output.
- `eslint` on all 8 changed/new files: clean, no output.
- Coverage against the plan's Test Plan: T-A1.1–T-A1.14 + T-A1.perf (15/15), T-A2.1–T-A2.14 plus the 12
  migrated cases (26/26), T-A4.1–T-A4.5 (5/5) — all present and green.
- Gaps: none identified against A1's scope. `csv-parse-rejections.tsx` rendering (T-A3), the full
  `step-upload-csv.tsx` rewiring with the rejections panel (T-A5), and the browser walk (I-1) are A2/I-1
  scope, not A1 — `step-upload-csv.tsx` in this task only maps `outcome` onto the pre-existing
  `setError`/`onParsed(rows)` calls per the dispatch's explicit "minimal, no new UI" instruction.

## Deferred / Tech Debt

None introduced by this task. Everything out-of-scope for A1 (rejections panel, page.tsx lifting the
full `ParseCsvResult`, template/help UI) is explicitly owned by later work items (A2, B1) per the plan's
dependency graph — not a gap in A1's own deliverable.

## Deviations From The Plan

None in the exported contract or file list — every signature matches AD-6 verbatim, and the file set
matches the plan's Structure table exactly (`csv-tokenizer.ts`, `parse-csv.ts`,
`step-upload-csv-helpers.ts` NEW/MOD as specified).

One line-count note: `csv-tokenizer.ts` landed at exactly 120 lines, matching the plan's Structure-table
target (`≤120 lines`) rather than only the looser 150-line hard cap mentioned in the dispatch's
Acceptance section — both are satisfied, flagging only because it required a compaction pass (initial
draft was 163 lines before merging several two/three-line `if` bodies onto single lines).

## Things The Plan Got Right (no corrections needed)

Every fixture in Appendix C traced cleanly to the implementation with zero surprises — the "checked
before count" ordering for `unterminated_quote` vs `column_count_mismatch` (AD-2, T-A2.6), the physical
line-number bookkeeping across blank lines and embedded newlines (T-A2.11 — the plan's own worked
example implicitly assumes line 5 for the third data record; I re-derived it independently from the raw
`\n` count in the fixture string and it agrees with the state-machine trace), and the BOM/leniency rules
in AD-1 all matched the tests written from the spec text with no reinterpretation needed.

## Review Hand-off

- Focus areas for code-review-analyzer: the tokeniser's escape/close-quote lookahead (`closeOrEscapeQuote`
  and the CR/LF-inside-quotes normalisation in `stepQuoted`) is the highest-risk, least-obvious code in
  this diff — worth a second pass against Appendix C's literal transition table.
- `parse-csv.ts`'s header comment (AD-6, AC-18.4) should be spot-checked against the actual issue #148
  wording for tone/accuracy; I followed the plan's given text closely but "may tighten" per the plan, so
  a reviewer preferring different phrasing is not a defect.
- No security-relevant surface here (pure client-side string parsing, no I/O, no wire-format change) —
  AC-X.2 (no change to `ImportBatchWireBody`/server modules/`package.json`) holds; confirmed via `git
  status --short` showing only the 8 files listed above plus the pre-existing T0/plan changes already in
  the working tree when this task started.
- `step-upload-csv.tsx` still renders no rejections UI (by design, A2's job) — a reviewer expecting to
  see the panel in this diff should be pointed at A2 in the dependency graph, not treated as a miss here.
