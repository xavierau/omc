---
id: artifacts/2026-08-28-wonb-019-upload-step-frontend
type: artifact
author: react-frontend-dev
created: 2026-08-28
status: active
supersedes: null
superseded_by: null
related: [kanban:WONB-019, kanban:WONB-018, github:147, github:148, plans/2026-08-28-wonb-018-019-csv-parser-and-template, artifacts/2026-08-28-wonb-018-tokenizer-backend]
---

# WONB-018/019 B1 + A2 — Download template, format help, parse-rejections panel, upload-step wiring

Merged work item (B1 + A2) of `plans/2026-08-28-wonb-018-019-csv-parser-and-template`. Builds on A1's
`parseCsv` → `ParseCsvResult` (`artifacts/2026-08-28-wonb-018-tokenizer-backend`). Adds the downloadable
CSV template + format help (#147 / WONB-019) and wires the upload step to lift the full parse result and
render its rejections panel (#148 / WONB-018 UI half).

## Files Changed

| File | Lines | Purpose |
|---|---|---|
| `src/lib/download-csv.ts` | 15 (NEW) | Shared Blob + `<a download>` helper, third occurrence of the pattern (AD-4) |
| `src/lib/__tests__/download-csv.test.ts` | 26 (NEW) | T-B1.1 |
| `src/components/dashboard/import-wizard/import-template.ts` | 24 (NEW) | `IMPORT_TEMPLATE_CSV`/`IMPORT_TEMPLATE_FILENAME`/`downloadImportTemplate` (Appendix B, BOM+CRLF) |
| `src/components/dashboard/import-wizard/__tests__/import-template.test.ts` | 87 (NEW) | T-B1.2–T-B1.6, incl. the `parseCsv` round-trip |
| `src/components/dashboard/import-wizard/csv-format-help.tsx` | 38 (NEW) | Always-visible help list + "Download CSV template" button (AD-5) |
| `src/components/dashboard/import-wizard/__tests__/csv-format-help.test.tsx` | 75 (NEW) | T-B2.1–T-B2.3 |
| `src/components/dashboard/import-wizard/csv-parse-rejections.tsx` | 57 (NEW) | Parse-rejects panel, mirrors `preview-rejections-panel.tsx` (AD-3) |
| `src/components/dashboard/import-wizard/__tests__/csv-parse-rejections.test.tsx` | 129 (NEW) | T-A3.1–T-A3.4 |
| `src/components/dashboard/import-wizard/step-upload-csv.tsx` | 103 (MOD, was 96) | Props → `parsed: ParseCsvResult`; renders `CsvFormatHelp` + `CsvParseRejections`; exports `EMPTY_CSV` |
| `src/components/dashboard/import-wizard/__tests__/step-upload-csv.test.tsx` | 158 (NEW) | T-A5.1–T-A5.5, hoisted-mock harness from `commit-rejections-list.test.tsx` |
| `src/app/dashboard/members/import/page.tsx` | 167 (MOD, unchanged line count) | `csv: ParseCsvResult` state (was `csvRows: ParsedRow[]`); `buildBatchInput` posts `csv.rows` |

`step-upload-csv-tag-feedback.test.ts` needed no change — it greps the step's source text for the literal
strings `csv.tagsFound`/`csv.tagsIgnored`, both still present verbatim.

## Key Decisions

- **`EMPTY_CSV` defined locally in `step-upload-csv.tsx`, not `parse-csv.ts`.** The plan (AD-7) offered
  either location; my dispatch's Boundaries explicitly forbid touching `parse-csv.ts`. Exported from
  `step-upload-csv.tsx` and imported by `page.tsx` — keeps the import direction page → component, matches
  how `StepUploadCsv` itself is already imported there.
- **Render order matches the plan exactly**: `csv.description` → `<CsvFormatHelp />` → picker →
  `csv.rowCount` (rows.length > 0) → tag stats (found/ignored) → `<CsvParseRejections
  rejected={parsed.rejected} />` → error → nav. Next is disabled purely on `parsed.rows.length === 0`;
  rejected-but-nonzero-rows and all-rejected both leave Next correctly enabled/disabled without touching
  `csv.errors.empty` (that stays server/`classifyParseResult`-driven).
- **`CsvParseRejections` mirrors `PreviewRejectionsPanel` structurally** (500-row cap, `overflow-y-auto`
  above 50, `data-section`, `data-reject-reason`) but is a distinct component/type — `CsvParseReject` is
  never coerced into the wire `ImportRowReject` shape, preserving AD-3's "never widen the wire mirror"
  rationale.
- **`CsvFormatHelp` reads `MAX_ROWS` from `step-upload-csv-helpers.ts` and `MAX_TAGS_PER_ROW` from
  `normalize-import-tags.ts`** (both already-exported, client-safe constants) rather than hardcoding —
  confirmed `normalize-import-tags.ts` has zero imports beyond nothing (pure domain module), safe for the
  client bundle.
- **Test assertions on flattened `children` arrays use `.join('')`, not `JSON.stringify`.** An earlier draft
  used `JSON.stringify` on the children array in `csv-parse-rejections.test.tsx`, which escapes `"` to `\"`
  and broke a literal substring match; switched to array `.join('')` (plain concatenation) to match how
  `commit-rejections-list.test.tsx` reads message text off `<li>` children.
- **Pre-existing corrupted `.next/dev/types/` build cache removed.** `tsc --noEmit` initially failed on
  syntax errors inside `.next/dev/types/routes.d.ts` / `validator.ts` — a truncated, mid-write Next.js
  dev-server artifact from before this task started (gitignored, gets regenerated). Deleted `.next/`
  (`rm -rf .next`); not a source change, just clearing stale generated output that was blocking `tsc`.

## Integration Map

| # | Row | Satisfied by |
|---|---|---|
| IM-2 | `step-upload-csv.tsx` renders `<CsvParseRejections rejected={parsed.rejected} />` below the row count | `step-upload-csv.tsx:84` (`<CsvParseRejections rejected={parsed.rejected} />`), after the row-count (`:69-73`) and tag-stat blocks |
| IM-3 | `page.tsx` lifts `ParseCsvResult`; `buildBatchInput` posts `csv.rows` (rejected rows can never be posted) | `page.tsx:63` (`const [csv, setCsv] = useState<ParseCsvResult>(EMPTY_CSV)`), `page.tsx:94` (`rows: csv.rows`) |
| IM-4 | `step-upload-csv.tsx` renders `<CsvFormatHelp />` (help list + template button) directly under `csv.description` | `step-upload-csv.tsx:44` (`<p>{t('csv.description')}</p>`) immediately followed by `step-upload-csv.tsx:47` (`<CsvFormatHelp />`) |
| IM-8 | `MAX_ROWS` has one definition (`step-upload-csv-helpers.ts`), read by the step and the help text | `step-upload-csv.tsx:8` and `csv-format-help.tsx:10` both `import { MAX_ROWS } from './step-upload-csv-helpers'` — no second definition introduced |
| IM-9 | Feature reachable: `/dashboard/members` → Import → step `csv` shows help, template button, and — after a malformed file — the rejections panel | Code-level trace: `page.tsx:132` renders `<StepUploadCsv parsed={csv} .../>` when `step === 'csv'`; `StepUploadCsv` unconditionally renders `<CsvFormatHelp/>` (with the `data-action="download-template"` button) and conditionally `<CsvParseRejections/>` from `parsed.rejected`. Full browser walk is I-1's scope (not dispatched to this task) — not exercised live here. |

## Tests

- Scoped suite (`vitest run src/components/dashboard/import-wizard src/lib src/app/dashboard/members`):
  **25 files / 177 tests, all green** (was 20 files / 155 tests before this task — net +5 files / +22
  tests: T-B1.1 (1), T-B1.2–T-B1.6 (6), T-B2.1–T-B2.3 (3), T-A3.1–T-A3.4 (7), T-A5.1–T-A5.5 (5)).
- Full suite, first run: **4 files / 10 tests failed**, 4313 passed, 21 skipped, 2 todo (4346) — all
  failures in `src/app/api/webhooks/whatsapp/__tests__/route.{window-tracking,quality-event,
  template-status,status-event}.integration.test.ts` (5s `Test timed out` errors + one row-count
  assertion off-by-one). None of these files were touched by this task.
- Full suite, second run (redirected to a file for a clean read, no `--reporter` override): **4 files / 6
  tests failed**, 4317 passed, 21 skipped, 2 todo (4346) — same four files, different subset of tests
  failed than run 1 (6 vs 10), confirming non-determinism rather than a real regression.
- Re-ran the 4 flaky files in isolation, both together (4 files / 6 failed, same as full-run-2) and one
  file at a time in separate `vitest run <file>` invocations: `route.window-tracking` 2/4 failed,
  `route.quality-event` 2/15 failed, `route.template-status` 1/12 failed, `route.status-event` **0/11
  failed (passed)**. Timeouts and row-count assertions vary run to run even fully isolated — this matches
  the project memory `project_flaky_webhook_integration_tests` (pre-existing shared-state pollution,
  non-CSV-import scope). Not chased per that memory and the dispatch's explicit instruction.
- `tsc --noEmit -p tsconfig.json`: clean (after removing the stale `.next/dev/types` cache — see Key
  Decisions).
- `eslint` on all 11 changed/new files: clean, no output.

## Deviations From The Plan

- `EMPTY_CSV` placed in `step-upload-csv.tsx` rather than `parse-csv.ts` — plan (AD-7) explicitly allowed
  either; the dispatch's Boundaries forbid editing `parse-csv.ts`, so this was the only compliant option,
  not a disagreement with the plan.
- No other deviations: file list, exported signatures, render order, `data-*` hooks, i18n key usage, and
  cap/scroll thresholds all match the plan (Structure, AD-3/4/5/7, Test Plan T-A3/T-A5/T-B1/T-B2)
  verbatim.

## Deferred / Tech Debt

- I-1 (browser walk, debugging journal, `gemini-cli-reviewer`/second-lane dispatch, qa-engineer verdict,
  `ui-test-runner`) is out of this task's scope per the dispatch. Note: `debugging_journals/
  2026-08-28-csv-column-shift.md` and `.claude-workspace/ui-map/` already exist untracked in the worktree
  (not created by this task) — flagged for the orchestrator/I-1, not touched here.
- The 4 flaky webhook integration test files above are pre-existing and unrelated to this task's scope;
  left untouched per project memory and the dispatch's explicit "do not chase" instruction.
