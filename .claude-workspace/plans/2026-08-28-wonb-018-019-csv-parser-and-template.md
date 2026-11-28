---
id: plans/2026-08-28-wonb-018-019-csv-parser-and-template
type: plan
author: solution-architect
created: 2026-08-28
status: active
supersedes: null
superseded_by: null
related: [kanban:WONB-018, kanban:WONB-019, github:148, github:147, kanban:WONB-017, plans/2026-08-28-tag-001-issues-138-139]
---

# Plan: WONB-018 + WONB-019 — RFC 4180 CSV parser with row rejection, and a downloadable import template (#148 + #147)

## Objective

One branch (`feature/wonb-018-issues-147-148`), one PR, two issues (precedent: PR #142 closed #138 + #139):

- **#148 / WONB-018 (bug, P2)** — `parseCsv` splits on a bare `,`. A quoted `"Chan, Tai Man"` shifts every
  later column: name truncated to `"Chan`, `preferred_language` → `null`, a junk tag literally named `zh_hk`
  minted in the tenant — and the row reports as imported. The header comment claims a server-side parser is
  the source of truth; it is not — the server receives already-parsed row objects and never sees the CSV
  text. Fix: RFC 4180 tokenising (quoted fields, `""` escapes, commas and newlines inside quotes, CRLF,
  leading BOM), reject any data row whose cell count differs from the header's and show it on the upload
  step with its line number and reason before commit, and correct the comment.
- **#147 / WONB-019 (enhancement, P2)** — no template exists and the format is one line of prose. Add a
  "Download CSV template" action on the upload step that yields `import-template.csv` (header
  `phone,name,preferred_language,tags` + example rows, one with a quoted comma-containing name), plus help
  text stating the real contract (required `phone` E.164, header aliases, `en`/`zh_hk` only, `;` tags,
  limits 50,000 rows / 10 tags per row / 40 chars per tag / 50 new tags per import). en + zh-HK.

## Context

### Verified state (read in the worktree at `738b5be`, = origin/develop = origin/main)

| File | Role today | Lines |
|---|---|---|
| `src/components/dashboard/import-wizard/parse-csv.ts` | `parseCsv(text): ParsedRow[]`; `text.split(/\r?\n/)`, `line.split(',')`, header aliases, `normaliseLang`, `normalizeImportTags` | 70 |
| `src/components/dashboard/import-wizard/step-upload-csv.tsx` | `handleFile` → `parseCsv` → `csv.errors.empty` / `csv.errors.tooManyRows` (`MAX_ROWS = 50_000`) → `onParsed(rows)`; renders `csv.description`, row count, tag stats | 98 |
| `src/components/dashboard/import-wizard/parse-csv-tag-stats.ts` | `computeCsvTagStats(rows: ParsedRow[])` — consumes `ParsedRow[]`, not the parser's return value | 26 |
| `src/app/dashboard/members/import/page.tsx` | wizard state: `csvRows: ParsedRow[]` lifted; `buildBatchInput` posts `rows: csvRows` | 167 |
| `src/app/api/dashboard/imports/_shared.ts` | `ImportBatchWireBody.rows: Array<{ phoneE164, name?, preferredLanguage?, tags? }>` — **the server never sees CSV text** | 127 |
| `src/hooks/use-import-batch-types.ts` | wire types; `ImportRejectReason` is a closed 4-value union mirrored from `domain/services/__errors__/import-errors.ts` | 91 |
| `src/components/dashboard/import-wizard/preview-rejections-panel.tsx` | preview-step rejections (server `rejected[]`), `data-section="preview-rejections"`, 500-row cap, scroll > 50 | 60 |
| `src/components/dashboard/import-wizard/commit-rejections-list.tsx` | post-commit rejections; **Blob + `<a download>` precedent** (`handleDownload`) | 120 |
| `src/app/admin/(dashboard)/billing/csv-export.ts` | second copy of the Blob download (`downloadCsv`) + BOM-prefixed CSV generation | 52 |
| `src/domain/services/normalize-import-tags.ts` | `MAX_TAGS_PER_ROW = 10` (exported), `MAX_TAG_NAME_LEN = 40` (not exported) | 61 |
| `src/application/import-contacts-batch-tags.ts` | `MAX_NEW_TAGS_PER_IMPORT = 50` — **server module (imports repositories); must not be imported by client code** | — |
| `src/messages/en.json`, `src/messages/zh-HK.json` | `importWizard.csv.*`; `src/messages/__tests__/locale-parity.test.ts` enforces identical deep key sets | — |
| `public/` | five stock Next.js SVGs only; no template anywhere | — |

Callers of `parseCsv` (all must survive the return-shape change): `step-upload-csv.tsx:26`,
`__tests__/parse-csv.test.ts` (11 cases), `__tests__/step-upload-csv-tag-feedback.test.ts:31`.
`ParsedRow` consumers (shape unchanged): `parse-csv-tag-stats.ts`, `page.tsx`, `parse-csv-tag-stats.test.ts`.

Test conventions in this directory: vitest, `__tests__/*.test.ts(x)`; component tests call the function
component directly and flatten the returned element tree (`renderTree` / `attr` helpers, `vi.mock('next-intl')`
returning `t:<key>:<json params>`); components using `useState`/`useRef` use the hoisted-mock harness in
`commit-rejections-list.test.tsx`; the Blob download is tested by stubbing `document.createElement`,
`URL.createObjectURL`, `URL.revokeObjectURL` (that file, "download CSV" describe). Pure logic is split into
`*-helpers.ts` siblings (`step-batch-meta-helpers.ts`, `proof-uploader-helpers.ts`, `commit-rejections-helpers.ts`).

### Constraints

- `~/Code/.claude/CLAUDE.md` Surgical Changes: every changed line traces to #148/#147; wiring (i18n in both
  locales) is part of the ask; existing files keep their style; new files < 150 lines, functions < 20 lines,
  params ≤ 3.
- WONB-017 invariant: the preview step performs zero DB writes. This plan does not touch the preview or
  commit paths at all, so the invariant is preserved by construction.
- `package.json` has no CSV dependency; `node_modules` was still installing when this plan was written —
  nothing was executed, all facts above come from reading the tree.
- The route middleware (`src/proxy.ts`, matcher `/dashboard/:path*`, `/admin/:path*`) does not cover
  `public/` assets — relevant to AD-3.

## Domain Model

No domain entity, aggregate, or migration changes. Everything here is presentation-layer parsing.

| Type | Kind | Where | Notes |
|---|---|---|---|
| `CsvRecord { line, cells, unterminated }` | value (tokeniser output) | `csv-tokenizer.ts` NEW | raw, untrimmed cells; `line` = 1-based physical line where the record starts |
| `ParsedRow` | value | `parse-csv.ts` | **unchanged** — `phoneE164, name, preferredLanguage, tags, ignoredTagCount` |
| `CsvParseReject { line, reason, expected, actual, phone }` | value | `parse-csv.ts` | client-only; never on the wire |
| `CsvParseRejectReason = 'column_count_mismatch' \| 'unterminated_quote'` | closed union | `parse-csv.ts` | distinct from `ImportRejectReason` (wire) on purpose — see AD-2 |
| `ParseCsvResult { phoneHeaderFound, rows, rejected }` | value | `parse-csv.ts` | new return type of `parseCsv` |
| `UploadOutcome` | value | `step-upload-csv-helpers.ts` NEW | pure classification of a `ParseCsvResult` into error / ok |

Dependency direction stays presentation → domain (`normalize-import-tags`), never the reverse. The
tokeniser imports nothing.

## Architecture Decisions

### AD-1 — Hand-rolled RFC 4180 tokeniser, not `papaparse`

**Decision:** new pure module `csv-tokenizer.ts` (single-pass state machine, no dependencies, < 150 lines,
fixture-driven tests). Do not add `papaparse` / `@types/papaparse`.

**Why:**
- The contract is deliberately narrow: `,` delimiter, `"` quote, `""` escape, `\r\n` / `\n` / lone `\r`
  terminators, optional leading U+FEFF. No delimiter sniffing, no type coercion, no streaming, no workers.
  That is ~80 lines of state machine; the fixture list in the Test Plan pins every branch.
- `papaparse` would add a runtime dependency to the dashboard bundle plus a `@types` devDependency, a
  `supply-chain-guard` review, and a configuration wrapper of its own (delimiter auto-detect off,
  `skipEmptyLines`, `dynamicTyping` off, header case-folding done by us anyway) — so the tests we would
  write are the same tests, plus dependency risk. The header comment's "swap in papaparse" was aspirational,
  not a decision; #148 explicitly allows "a small RFC 4180 tokeniser".
- Perf: one `charCodeAt` loop is O(n) and comfortably inside the budget (see Performance Budgets); the
  library would not be faster for a 3 MB string.

**Leniency (stated so the tokeniser stays small and no well-formed file regresses):**
- An opening `"` is recognised at field start **after optional spaces/tabs** — hand-edited files in this
  codebase use `phone, name` spacing (existing test "trims whitespace from cells"), so `+852…, "Chan, Tai Man"`
  must parse as two cells, not reproduce the bug.
- A `"` that is not at field start is literal (`ab"c` → `ab"c`). Characters between a closing `"` and the
  next delimiter are appended literally; `parseCsv` trims afterwards, so `"Chan, Tai Man" ,` → `Chan, Tai Man`.
  Neither case can shift columns, so neither is a rejection.
- An unterminated quote (EOF while inside quotes) yields the final record with `unterminated: true` and the
  remainder of the file in its last cell. It is necessarily the last record, so nothing after it is lost
  silently — the rejection message says so (AD-4).
- Blank records (whitespace-only physical line outside quotes) are skipped, never rejected — existing
  behaviour (`filter(Boolean)`), and the tokeniser still counts the line so later line numbers stay physical.
- U+FEFF at index 0 is stripped inside the tokeniser regardless of whether the browser's `Blob.text()`
  already did it — the unit tests feed strings, and the parser must not depend on the caller.

### AD-2 — Column-count policy: header count N; any data row with cell count ≠ N is rejected (fewer AND more)

**Decision:** `column_count_mismatch` for both directions, carrying `expected: N` and `actual: M`.

**Why:** "more" is the comma-shift signature the issue describes. "Fewer" is ambiguous — a tool that drops
trailing empty fields (harmless) is indistinguishable from a truncated row or a row whose missing cell is
not the last one (index-mapping would then assign the wrong column silently, which is the exact class of
bug being fixed). The rejection is shown before commit with the line number, so the cost of strictness is
one re-upload; the cost of tolerance is silent misalignment. This also matches the issue's wording
("differs"). Excel and Google Sheets emit trailing empty fields (`+852…,Wong,,`), which tokenise to N cells
and are accepted — the "trailing empty field" fixture pins that.

`unterminated_quote` is checked first and is a distinct reason: a quote opened in the **last** column
swallows the rest of the file into a record that may still have exactly N cells.

Blank `phone` rows keep their existing behaviour (silently skipped, not rejected) — WONB-018 AC5 says
well-formed behaviour is unchanged; surfacing blank phones is listed under Risks as a follow-up.

### AD-3 — Rejections are rendered on the upload step, not threaded into the preview panel

**Decision:** new component `csv-parse-rejections.tsx` rendered by `step-upload-csv.tsx` immediately after
parse, visually mirroring `PreviewRejectionsPanel` (same destructive border, 500-row render cap, scroll
above 50, `data-section="csv-parse-rejections"`, one `<li data-reject-reason data-reject-line>` per row).
The full `ParseCsvResult` is lifted into `page.tsx` state (replacing `csvRows: ParsedRow[]`) so the panel
survives Back-navigation from the preview step, exactly as `rows` does today.

**Why not the preview panel:**
- `PreviewRejectionsPanel` is typed on the wire `ImportRowReject` (`phoneE164` + closed `ImportRejectReason`).
  Parse rejects have a line number, may have no usable phone, and must never be posted to the server —
  widening the client mirror of a wire type to carry client-only reasons muddles the "no wire change"
  non-goal and `commit-rejections-helpers.ts`'s `REASON_ORDER`.
- Feedback timing: the preview step only exists after `POST /imports/preview` succeeds. Showing "line 12
  could not be read" one click later, mixed with server verdicts, is a worse loop than showing it next to
  the file picker where the operator can fix and re-pick immediately.
- Zero coupling to the preview/commit paths means the WONB-017 zero-write invariant and the merge-toggle
  0-request budget cannot regress.

**Consequence accepted:** the preview step's `preview.rejectedNone` ("No rows rejected. N contacts ready")
will not mention parse rejections. Counts stay consistent (rejected rows are excluded from `rows`, so N is
right); only the wording is narrower. Recorded under Risks with a cheap follow-up if product wants it.

Rejected rows are excluded from `rows`, so they can never reach `buildBatchInput` — that is the "never
imported mangled" guarantee. Next stays enabled whenever `rows.length > 0` (server rejections do not block
Next either); when every data row is rejected, `rows` is empty, Next is disabled, and the panel is the only
message (no `csv.errors.empty`, which would be false — see `classifyParseResult`).

### AD-4 — Template is generated client-side (Blob + `<a download>`), not a static `public/` file

**Decision:** `import-template.ts` exports `IMPORT_TEMPLATE_CSV` (BOM + CRLF, Appendix B),
`IMPORT_TEMPLATE_FILENAME = 'import-template.csv'`, and `downloadImportTemplate()`; the Blob/anchor code
moves to a new `src/lib/download-csv.ts` (`downloadCsv(csv, filename)`, body identical to the billing copy).

**Why:**
- The wizard's own precedent is a client-side Blob download (`commit-rejections-list.tsx`); the admin area
  has a second copy. This is the third use — DRY says extract now, so the extraction lands in `src/lib/`.
  The two existing copies are **not** migrated (Surgical Changes); the PR description mentions them.
- A file under `public/` is a deploy-artifact concern: the release tarball has already lost nested runtime
  files once (PR #115, `bsdtar --exclude` incident), and a template that 404s in prod is invisible to unit
  tests. A generated string cannot be lost by packaging.
- The content is pinned by a round-trip unit test (`parseCsv(IMPORT_TEMPLATE_CSV)` → exactly the example
  rows, `rejected: []`), so the template can never drift from the parser — and because the string starts
  with U+FEFF and uses CRLF, the same test proves BOM stripping and CRLF handling on the real artefact.
- BOM + CRLF are required for Excel on Windows to open UTF-8 (the example rows include a Chinese name,
  which is the realistic HK case); the billing exporter already does this. Both are trivially controlled in
  a string, and the anchor's `download` attribute fixes the filename.
- `public/` would also bypass the dashboard middleware — harmless for a template, but a static file has no
  advantage that outweighs the above.

### AD-5 — Help text is a structured, always-visible list next to the picker; numbers are interpolated where a client-safe constant exists, hardcoded otherwise

`csv-format-help.tsx` (NEW, B1) renders `csv.help.title` + five lines (`phone`, `name`, `language`,
`tags`, `limits`) and the download button, `data-section="csv-help"`. `{maxRows}` comes from the step's
`MAX_ROWS` (moved to a shared const in `step-upload-csv-helpers.ts` so both files read one value) and
`{maxTagsPerRow}` from `MAX_TAGS_PER_ROW` (domain export, already imported by `parse-csv.ts`). "40 characters"
and "50 new tags" are hardcoded in the strings following the existing precedent (`csv.tagsIgnored`,
`confirm.errors.too_many_new_tags`): `MAX_TAG_NAME_LEN` is not exported and `MAX_NEW_TAGS_PER_IMPORT` lives
in a server module that must not enter the client bundle. Header aliases are spelled out in the strings.

### AD-6 — `parseCsv` return shape and header-comment text

```ts
// src/components/dashboard/import-wizard/parse-csv.ts (MODIFY)

export interface ParsedRow {            // UNCHANGED
  phoneE164: string
  name: string | null
  preferredLanguage: 'en' | 'zh_hk' | null
  tags: string[]
  ignoredTagCount: number
}

export type CsvParseRejectReason = 'column_count_mismatch' | 'unterminated_quote'

export interface CsvParseReject {
  /** 1-based physical line where the record starts. The header is line 1. */
  line: number
  reason: CsvParseRejectReason
  /** Header cell count. */
  expected: number
  /** This record's cell count. */
  actual: number
  /** Trimmed phone cell when the record has one at the header's phone index and it is non-empty. */
  phone: string | null
}

export interface ParseCsvResult {
  /** false when the text is empty or no header cell matches a phone alias — the existing
   *  `csv.errors.empty` path. `rows` and `rejected` are both [] in that case. */
  phoneHeaderFound: boolean
  rows: ParsedRow[]
  rejected: CsvParseReject[]
}

export function parseCsv(text: string): ParseCsvResult
```

```ts
// src/components/dashboard/import-wizard/csv-tokenizer.ts (NEW, zero imports)

export interface CsvRecord {
  /** 1-based physical line where the record starts. */
  line: number
  /** Raw cells — not trimmed; quotes and `""` escapes already resolved. */
  cells: string[]
  /** true only on the final record, when EOF was reached inside a quoted field. */
  unterminated: boolean
}

export function tokenizeCsv(text: string): CsvRecord[]
```

```ts
// src/components/dashboard/import-wizard/step-upload-csv-helpers.ts (NEW)

export const MAX_ROWS = 50_000   // moved from step-upload-csv.tsx; the step imports it from here

export type UploadOutcome =
  | { kind: 'error'; error: 'empty' | 'tooManyRows' }
  | { kind: 'ok'; result: ParseCsvResult }

/** !phoneHeaderFound → empty · rows=[] && rejected=[] (header-only) → empty ·
 *  rows.length > maxRows → tooManyRows (accepted rows only, as today) · else ok. */
export function classifyParseResult(result: ParseCsvResult, maxRows: number): UploadOutcome
```

```ts
// src/components/dashboard/import-wizard/import-template.ts (NEW)
export const IMPORT_TEMPLATE_FILENAME = 'import-template.csv'
export const IMPORT_TEMPLATE_CSV: string        // Appendix B, BOM-prefixed, CRLF
export function downloadImportTemplate(): void  // downloadCsv(IMPORT_TEMPLATE_CSV, IMPORT_TEMPLATE_FILENAME)

// src/lib/download-csv.ts (NEW)
export function downloadCsv(csv: string, filename: string): void
```

Header comment for `parse-csv.ts` (replaces lines 1–8; wording is the spec, dev may tighten):

> Client-side CSV parser for the import wizard. **This is the only parser**: the client posts already-parsed
> row objects (`ImportBatchWireBody.rows`), the server never receives the CSV text, and nothing downstream
> re-checks column alignment. Tokenising is RFC 4180 (`csv-tokenizer.ts`: quoted fields, `""` escapes,
> commas/newlines inside quotes, CRLF, leading BOM). Header-driven: `phone` (required), `name`,
> `preferred_language`, `tags`, matched case-insensitively by alias. Data rows whose cell count differs from
> the header's are rejected here (`rejected[]`) and shown on the upload step — never imported shifted.

### AD-7 — Wizard state holds the whole `ParseCsvResult`

`page.tsx`: `const [csv, setCsv] = useState<ParseCsvResult>(EMPTY_CSV)`; `StepUploadCsv` props become
`parsed: ParseCsvResult` + `onParsed: (result: ParseCsvResult) => void`; `buildBatchInput` reads
`csv.rows`; `computeCsvTagStats(parsed.rows)`. One state, one setter, Back-navigation keeps the panel.

## Structure

```
src/lib/
  download-csv.ts                                   NEW   (B1)  ~12 lines
src/components/dashboard/import-wizard/
  csv-tokenizer.ts                                  NEW   (A1)  ≤ 120 lines, zero imports
  parse-csv.ts                                      MOD   (A1)  new comment, uses tokenizer, ParseCsvResult
  step-upload-csv-helpers.ts                        NEW   (A1)  MAX_ROWS, classifyParseResult
  step-upload-csv.tsx                               MOD   (A1 minimal → A2 full)
  csv-parse-rejections.tsx                          NEW   (A2)  ≤ 70 lines
  csv-format-help.tsx                               NEW   (B1)  ≤ 60 lines
  import-template.ts                                NEW   (B1)  ≤ 30 lines
  __tests__/csv-tokenizer.test.ts                   NEW   (A1)
  __tests__/parse-csv.test.ts                       MOD   (A1)  migrate to .rows, add rejection cases
  __tests__/step-upload-csv-helpers.test.ts         NEW   (A1)
  __tests__/step-upload-csv-tag-feedback.test.ts    MOD   (A1)  line 31: parseCsv(...).rows[0]
  __tests__/csv-parse-rejections.test.tsx           NEW   (A2)
  __tests__/step-upload-csv.test.tsx                NEW   (A2)
  __tests__/csv-format-help.test.tsx                NEW   (B1)
  __tests__/import-template.test.ts                 NEW   (B1)  round-trip; green only after A1
src/lib/__tests__/download-csv.test.ts              NEW   (B1)
src/app/dashboard/members/import/page.tsx           MOD   (A2)  csv state = ParseCsvResult
src/messages/en.json, src/messages/zh-HK.json       MOD   (T0)  Appendix A
```

Untouched on purpose: `parse-csv-tag-stats.ts` (+ test), `preview-rejections-panel.tsx`,
`commit-rejections-*.ts(x)`, `use-import-batch-types.ts`, `_shared.ts`, every server/domain module,
`public/`, `package.json`.

## Integration Map

| # | Registration point | Owner |
|---|---|---|
| IM-1 | `parseCsv` returns `ParseCsvResult`; every caller compiles (`step-upload-csv.tsx`, both tests) | A1 |
| IM-2 | `step-upload-csv.tsx` renders `<CsvParseRejections rejected={parsed.rejected} />` below the row count | A2 |
| IM-3 | `page.tsx` lifts `ParseCsvResult`; `buildBatchInput` posts `csv.rows` (rejected rows can never be posted) | A2 |
| IM-4 | `step-upload-csv.tsx` renders `<CsvFormatHelp />` (help list + "Download CSV template" button, `data-action="download-template"`) directly under `csv.description` | A2 (wiring) / B1 (component) |
| IM-5 | All keys in Appendix A present in **both** `en.json` and `zh-HK.json`; `locale-parity.test.ts` green | T0 |
| IM-6 | `importWizard.csv.description` reworded to point at the template + help | T0 |
| IM-7 | `parse-csv.ts` header comment corrected (WONB-018 AC4) | A1 |
| IM-8 | `MAX_ROWS` has one definition (`step-upload-csv-helpers.ts`), read by the step and the help text | A1 (move) / B1 (read) |
| IM-9 | Feature reachable: `/dashboard/members` → Import → step `csv` (`?step=csv`) shows help, template button, and — after picking a malformed file — the rejections panel | I-1 |
| IM-10 | Kanban WONB-018 / WONB-019 `workspace_artifacts` list this plan id (orchestrator; not a dev edit) | — |

Routes: none. Nav/menu: none (the wizard is already reachable). DI: none (module-level functions).
Permissions: none (client-only change inside an already tenant-guarded page). Feature flags: none.
Migrations: none. Wire contract: none.

## Subtasks

Six work items, one dispatch each. Model pins per `~/Code/.claude/CLAUDE.md`: qa-engineer `opus`, devs
`sonnet`. Every dev item is a subagent: execute directly, spawn nothing (except its agent file's named
review handoff).

---
### Q-0 — Frozen acceptance suite (qa-engineer, model: opus)
**Depends on:** nothing. Runs before any dev dispatch (may run alongside T0).
**Owns:** `.claude-workspace/tests/2026-08-28-wonb-018-019-acceptance.md` + the executable failing suite it
describes.
**Spec:** author from #148 + #147 + this plan's Acceptance Criteria, Test Plan fixtures, Performance
Budgets and Feedback States. It must fail today (the #148 row parses mangled; `IMPORT_TEMPLATE_CSV` does not
exist). Do not invent budgets or states — flag anything missing.
**Exit:** the frozen suite id, referenced by every dev item as its target.

---
### T0 — i18n keys, both locales (senior-backend-dev, model: sonnet)
**Depends on:** nothing. **Files (2):** `src/messages/en.json`, `src/messages/zh-HK.json`.
**Spec:** add exactly the keys in Appendix A verbatim, in both locales, inside the existing
`importWizard.csv` block; reword `csv.description` as given. No other change to either file.
**TDD:** `src/messages/__tests__/locale-parity.test.ts` stays green; add nothing else.
**AC:** both files parse; deep key sets identical; IM-5, IM-6.

---
### A1 — Tokeniser + `parseCsv` + outcome helper (senior-backend-dev, model: sonnet)
**Depends on:** Q-0 (target). **Files (4 src):** `csv-tokenizer.ts` NEW, `parse-csv.ts`,
`step-upload-csv-helpers.ts` NEW, `step-upload-csv.tsx` (**minimal**: import `MAX_ROWS` from the helper,
`const outcome = classifyParseResult(parseCsv(text), MAX_ROWS)`, map `outcome` onto the existing
`setError`/`onParsed(rows)` calls — keep `onParsed(rows: ParsedRow[])` for now so `page.tsx` is untouched).
**Spec:** Appendix C state machine; AD-1, AD-2, AD-6; header comment per AD-6; `parseCsv`: header = first
record (cells trimmed + lower-cased), `expected = header.cells.length`; for each data record: skip if
blank (tokeniser already did), reject `unterminated_quote` if `unterminated`, reject
`column_count_mismatch` if `cells.length !== expected`, else existing mapping (trim, `cellOrNull`,
`normaliseLang`, `normalizeImportTags`), blank phone → skip silently (existing).
**TDD:** `csv-tokenizer.test.ts` (T-A1.*) and the new `parse-csv.test.ts` cases (T-A2.*) written RED first;
the 11 existing `parse-csv` cases migrated to `.rows` and kept; `step-upload-csv-tag-feedback.test.ts:31`
→ `.rows[0]`; `step-upload-csv-helpers.test.ts` (T-A4.*).
**Constraints:** tokeniser file ≤ 150 lines, functions ≤ 20 lines (split the state machine into
`readQuoted` / `readUnquoted` / `pushRecord` style helpers if needed), no regex inside the per-char loop,
no `text.split` of the whole input, O(n).
**AC:** T-A1.*, T-A2.*, T-A4.*, T-A1.perf; whole suite green; `tsc` clean; IM-1, IM-7, IM-8.

---
### B1 — Template, download helper, help component (react-frontend-dev, model: sonnet)
**Depends on:** T0 (keys exist; tests mock `next-intl` anyway), Q-0 (target). **May start in parallel with
A1** — B1 touches only NEW files (`src/lib/download-csv.ts`, `import-template.ts`, `csv-format-help.tsx`,
their tests). It does **not** edit `step-upload-csv.tsx` (A2 wires it — IM-4).
**Spec:** AD-4, AD-5, Appendix B. `CsvFormatHelp` props: none (reads `MAX_ROWS` from
`step-upload-csv-helpers.ts` once A1 lands — until then import from the same path; if A1 is not yet merged,
the import fails typecheck: write the component last, or land it with a local fallback that A2 removes.
Preferred: order B1 after A1 when both cannot run truly concurrently).
**TDD:** `download-csv.test.ts` (T-B1.1), `csv-format-help.test.tsx` (T-B2.*), `import-template.test.ts`
(T-B1.2–T-B1.6). **The round-trip test T-B1.4 is RED until A1 lands** — write it last; B1's Exit requires a
rebase onto A1 and a green run. If A1 is not merged when B1 reaches this point, B1 writes its handoff and
the orchestrator continues it (SendMessage) or spawns a cold successor after A1.
**AC:** T-B1.*, T-B2.*; WONB-019 AC1–AC2 at unit level; no edit to any existing file.

---
### A2 — Upload-step wiring: parse result lifted, rejections panel, help + template button (react-frontend-dev, model: sonnet)
**Depends on:** A1 and B1 merged. **Files (3 src):** `csv-parse-rejections.tsx` NEW, `step-upload-csv.tsx`,
`page.tsx`.
**Spec:** AD-3, AD-7. `StepUploadCsv` props: `parsed: ParseCsvResult`, `onParsed(result: ParseCsvResult)`,
`onBack`, `onNext`; `handleFile`: `outcome = classifyParseResult(parseCsv(await file.text()), MAX_ROWS)`;
`error` → `setError(t('csv.errors.<error>'))` + `onParsed(EMPTY_CSV)`; `ok` → `setError(null)` +
`onParsed(outcome.result)`. Render order: `csv.description` → `<CsvFormatHelp />` → picker →
`csv.rowCount` (when `rows.length > 0`) → tag stats → `<CsvParseRejections rejected={parsed.rejected} />`
→ `error` → nav. `CsvParseRejections`: renders `null` when empty; otherwise `csv.rejectedTitle` +
`<ul>` (scroll class above 50) of `<li data-reject-reason data-reject-line>`:
`{t('csv.rejectLine', {line})} · {phone ?? ''} · {t(`csv.reason.${reason}`, {expected, actual})}`; cap 500 +
`csv.showingFirst`. `page.tsx`: `EMPTY_CSV: ParseCsvResult = { phoneHeaderFound: false, rows: [], rejected: [] }`,
`csv` state, `rows: csv.rows` in `buildBatchInput`, props renamed.
**TDD:** `csv-parse-rejections.test.tsx` (T-A3.*), `step-upload-csv.test.tsx` (T-A5.*) — hoisted-mock
harness from `commit-rejections-list.test.tsx`.
**AC:** T-A3.*, T-A5.*; IM-2, IM-3, IM-4; whole suite green; `tsc` clean.

---
### I-1 — Integration (react-frontend-dev, model: sonnet) — NEVER OPTIONAL
**Depends on:** A2. **Spec:** walk the Integration Map as a checklist and prove IM-9 from the app entry
point with the dev server running: login → `/dashboard/members` → Import → Next past metadata →
`?step=csv`: help list visible in en and zh-HK, click "Download CSV template" → file named
`import-template.csv`, opens with the four example rows; pick that file → "4 rows ready to grade",
"2 tags found", no rejections; pick the #148 fixture **unquoted** (`+85290001234,Chan, Tai Man,zh_hk,VIP`)
→ panel "1 rows could not be read…", entry "Line 2 · +85290001234 · Expected 4 columns but found 5…",
Next disabled; pick it **quoted** → 1 row ready, no panel; Next → preview shows name `Chan, Tai Man`
(preview requires the DB — if the dev DB is unavailable per the 2026-08-28 incident memory, stop at the
upload step, record the gap, and cover the preview hop with the existing unit tests). The upload step
itself is client-only and needs no DB. Run the full vitest suite, `tsc`, lint. Write a debugging journal
entry for #148 (`debugging_journals/2026-08-28-csv-column-shift.md` — mandatory for bug fixes).
**Exit:** `artifacts/2026-08-28-wonb-018-019-integration-frontend.md` with every IM row ticked and the
browser evidence; hand to the review gate (gemini-cli-reviewer + second lane) → qa-engineer verdict →
ui-test-runner.

### Dependency order / dispatch waves

```
Wave 0:  Q-0 ∥ T0
Wave 1:  A1 ∥ B1          (B1 only NEW files; B1's Exit waits for A1 — see B1)
Wave 2:  A2
Wave 3:  I-1 → {gemini-cli-reviewer ∥ second review lane} → qa-engineer verdict → ui-test-runner
```

Only A1, A2 edit `step-upload-csv.tsx`, and they are sequential; only A2 edits `page.tsx`; only T0 edits
the JSON files. No two concurrent items share a file.

## Acceptance Criteria

WONB-018 (#148):
- **AC-18.1** `phone,name,preferred_language,tags` / `+85290001234,"Chan, Tai Man",zh_hk,VIP` → one row
  `{ phoneE164:'+85290001234', name:'Chan, Tai Man', preferredLanguage:'zh_hk', tags:['VIP'], ignoredTagCount:0 }`,
  `rejected: []`. No shifted columns, no junk tag.
- **AC-18.2** `""` escapes, commas inside quotes, a quoted field containing a newline, CRLF endings and a
  leading UTF-8 BOM all parse per RFC 4180 (fixtures T-A1.2–T-A1.7).
- **AC-18.3** A data row whose cell count ≠ header count is rejected, excluded from `rows`, and shown on
  the upload step with its line number and a reason, before commit; the row can never be posted.
- **AC-18.4** `parse-csv.ts`'s header comment states the client parser is the only parser and no longer
  claims a server-side source of truth.
- **AC-18.5** All 11 pre-existing `parse-csv` behaviours hold for well-formed files (migrated tests).

WONB-019 (#147):
- **AC-19.1** The upload step offers "Download CSV template" producing `import-template.csv` with header
  `phone,name,preferred_language,tags` and the example rows in Appendix B, one with a quoted comma name.
- **AC-19.2** `parseCsv(IMPORT_TEMPLATE_CSV)` → `phoneHeaderFound: true`, `rejected: []`, and exactly the
  four expected rows (quoted name intact, tags split, language normalised, empty tags → `[]`).
- **AC-19.3** Help text on the upload step states: `phone` required (E.164), the header aliases for all
  four columns, `preferred_language` accepts `en` or `zh_hk` only, tags separated by `;`, and the limits
  50,000 rows / 10 tags per row / 40 chars per tag / 50 new tags per import.
- **AC-19.4** Every new string exists in both `en.json` and `zh-HK.json` (parity test green).

Cross-cutting:
- **AC-X.1** Feature reachable end-to-end from the app entry point (`/dashboard/members` → Import →
  `?step=csv`) with help, template button and rejections panel rendered — I-1 evidence.
- **AC-X.2** No change to `ImportBatchWireBody`, `use-import-batch-types.ts`, any server/domain module,
  `package.json`, or the preview/commit code paths (diff review).
- **AC-X.3** New files ≤ 150 lines; new functions ≤ 20 lines; no `any`.

## Performance Budgets

qa-engineer measures against these. None is "not applicable".

| Path | Budget | Enforcement |
|---|---|---|
| `parseCsv` on a 50,000-row × 4-column file (~3 MB, no quotes) | ≤ 500 ms main-thread on a mid-range laptop; no worker, no chunking needed | single `charCodeAt` pass, O(n); T-A1.perf asserts ≤ 2,000 ms in vitest as an O(n²)-regression guard only (loose bound to avoid CI flake) |
| `parseCsv` on the same file with every `name` quoted | ≤ 750 ms | same test, quoted variant |
| `handleFile` → panel/row-count visible | parse time + one render; no network | client-only, asserted by T-A5 (no fetch mocked or called) |
| `CsvParseRejections` with 50,000 rejections | renders ≤ 500 `<li>`; no layout jank | `MAX_RENDERED_ROWS = 500` (mirror of preview panel), T-A3.4 |
| "Download CSV template" click | < 50 ms, 0 network requests, synchronous | Blob from an in-memory constant, T-B1.1 |
| Bundle | 0 new dependencies | `package.json` unchanged (AC-X.2) |

## Feedback States

**1. CSV upload (`step-upload-csv`)** — per file pick:
- success: existing `csv.rowCount` (+ `csv.tagsFound` when any row carries a tag).
- warning: existing `csv.tagsIgnored`.
- **rejected (NEW):** `csv.rejectedTitle` panel, one line per row: `csv.rejectLine` · phone (if any) ·
  `csv.reason.<reason>`; above 500 rows `csv.showingFirst`. Rows in the panel are excluded from the import.
  Rendered together with `csv.rowCount` when some rows survived; alone (Next disabled) when none did.
- error: existing `csv.errors.empty` (no phone header, or header only) / `csv.errors.tooManyRows`
  (accepted rows > 50,000). `csv.errors.empty` is **not** shown when rows exist only in `rejected`.

**2. Help + template (`csv-format-help`)** — static help list, always visible; "Download CSV template"
triggers an immediate browser download, no toast (matches the `confirm.downloadCsv` precedent).

## Test Plan

Fixtures are literal strings in the tests (no fixture files). `H4 = 'phone,name,preferred_language,tags'`.

**T-A1 — `csv-tokenizer.test.ts`**
- T-A1.1 plain `a,b,c\n1,2,3` → two records, cells `['a','b','c']`, `['1','2','3']`, lines 1 and 2.
- T-A1.2 quoted comma: `x,"Chan, Tai Man",y` → 3 cells, middle `Chan, Tai Man`.
- T-A1.3 `""` escape: `"He said ""hi""",z` → `He said "hi"`.
- T-A1.4 embedded newline: `"line1\nline2",z\nnext,row` → record 1 cell `line1\nline2`, record 2 `line: 3`.
- T-A1.5 CRLF: `a,b\r\n1,2\r\n` → no `\r` in any cell, 2 records.
- T-A1.6 lone CR: `a,b\r1,2` → 2 records.
- T-A1.7 BOM: `'﻿phone,name\n…'` → first header cell exactly `phone`.
- T-A1.8 trailing empty field: `a,b,\n1,,` → 3 cells each, last cells `''`.
- T-A1.9 unterminated quote: `a,b\n1,"open\n2,3` → record 2 `unterminated: true`, cells `['1','open\n2,3']`,
  record 1 intact; it is the last record.
- T-A1.10 blank lines skipped, physical line numbers kept: `a\n\n  \nb` → records at lines 1 and 4.
- T-A1.11 space before opening quote: `a, "b, c"` → 2 cells, second `b, c` (after trim by caller: raw is `b, c`).
- T-A1.12 stray quote mid-field is literal: `ab"c,d` → `ab"c`.
- T-A1.13 text after closing quote is appended: `"ab"cd,e` → `abcd`.
- T-A1.14 last line without trailing newline is emitted; empty string → `[]`; `"\n\n"` → `[]`.
- T-A1.perf 50,000 rows generated in-test (plain and quoted variants) complete under 2,000 ms.

**T-A2 — `parse-csv.test.ts`** (plus the 11 migrated cases, each asserting on `.rows`)
- T-A2.1 the #148 row (quoted) → AC-18.1 exactly.
- T-A2.2 the #148 row **unquoted** → `rows: []`, `rejected: [{ line: 2, reason: 'column_count_mismatch', expected: 4, actual: 5, phone: '+85290001234' }]`.
- T-A2.3 fewer cells: `H4\n+852…,Wong` → rejected `expected: 4, actual: 2`.
- T-A2.4 trailing empties accepted: `H4\n+852…,Wong,,` → one row, `preferredLanguage: null`, `tags: []`, `rejected: []`.
- T-A2.5 unterminated quote → `reason: 'unterminated_quote'`, `line` = the record's start line; rows before it parsed.
- T-A2.6 unterminated quote in the last column with exactly N cells → still `unterminated_quote` (checked before count).
- T-A2.7 BOM + header → `phoneHeaderFound: true`, phone matched.
- T-A2.8 empty text → `{ phoneHeaderFound: false, rows: [], rejected: [] }`; header without phone alias → same.
- T-A2.9 header-only → `{ phoneHeaderFound: true, rows: [], rejected: [] }`.
- T-A2.10 blank phone row → skipped silently, not in `rejected` (existing behaviour, AC-18.5).
- T-A2.11 line numbers: rejection after a blank line and after an embedded-newline record are physical.
- T-A2.12 quoted header cells (`"phone","name"`) match aliases.
- T-A2.13 `phone` on a reject is `null` when the phone cell is empty or the record is shorter than the phone index.
- T-A2.14 a rejected row contributes nothing to tags: `H4\n+852…,Chan, Tai Man,zh_hk,VIP` → `rows: []` (no `zh_hk` tag anywhere).

**T-A3 — `csv-parse-rejections.test.tsx`** (renderTree pattern)
- T-A3.1 empty → renders `null`.
- T-A3.2 one `<li>` per reject with `data-reject-reason`, `data-reject-line`; children contain `t:csv.rejectLine:{"line":2}`, the phone, and `t:csv.reason.column_count_mismatch:{"expected":4,"actual":5}`.
- T-A3.3 title `t:csv.rejectedTitle:{"count":N}`; root `data-section="csv-parse-rejections"`.
- T-A3.4 cap 500 + `t:csv.showingFirst:{"shown":500,"count":700}`; no note at ≤ 500; scroll class above 50.

**T-A4 — `step-upload-csv-helpers.test.ts`**
- T-A4.1 `phoneHeaderFound: false` → `{ kind:'error', error:'empty' }`.
- T-A4.2 header-only → `error: 'empty'`.
- T-A4.3 `rows: []`, `rejected: [x]` → `kind: 'ok'` (panel, not the empty error).
- T-A4.4 `rows.length === maxRows` → ok; `maxRows + 1` → `tooManyRows`; rejected rows do not count.
- T-A4.5 `MAX_ROWS === 50_000`.

**T-A5 — `step-upload-csv.test.tsx`** (hoisted-mock harness)
- T-A5.1 renders `<CsvFormatHelp>` and the picker; `data-step="upload-csv"` kept.
- T-A5.2 with `parsed.rejected` non-empty → `CsvParseRejections` element present with those rows.
- T-A5.3 `rows: []`, `rejected: [x]` → Next disabled, no `csv.errors.empty` text.
- T-A5.4 `rows: [r]`, `rejected: [x]` → row count and panel both present.
- T-A5.5 no `fetch` is referenced/called anywhere in the step (client-only).

**T-B1 — `download-csv.test.ts`, `import-template.test.ts`**
- T-B1.1 `downloadCsv` creates a `text/csv;charset=utf-8;` Blob URL, sets `download`, clicks, revokes (stub pattern from `commit-rejections-list.test.tsx`).
- T-B1.2 `IMPORT_TEMPLATE_CSV` starts with `﻿`, uses `\r\n`, first line exactly `phone,name,preferred_language,tags`.
- T-B1.3 contains the quoted comma-name row verbatim (`"Chan, Tai Man"`).
- T-B1.4 **round-trip**: `parseCsv(IMPORT_TEMPLATE_CSV)` deep-equals `{ phoneHeaderFound: true, rejected: [], rows: <Appendix B expected rows> }`.
- T-B1.5 `downloadImportTemplate()` calls `downloadCsv` with `IMPORT_TEMPLATE_CSV` and `'import-template.csv'`.
- T-B1.6 the template has no line longer than 80 chars and no tab characters (keeps it readable in any editor).

**T-B2 — `csv-format-help.test.tsx`**
- T-B2.1 renders `t:csv.help.title` and the five help lines with `{maxRows: 50000}` / `{maxTagsPerRow: 10}` params where specified.
- T-B2.2 button `data-action="download-template"` labelled `t:csv.downloadTemplate`; click calls `downloadImportTemplate` (mocked module).
- T-B2.3 root `data-section="csv-help"`.

**T-T0 — locale parity** — existing test green; additionally assert (in `csv-format-help.test.tsx` or a
one-off) that `en.importWizard.csv` and `zhHK.importWizard.csv` both contain the Appendix A key list.

**I-1 browser walk** — see subtask I-1.

## Out of Scope

- Server-side re-parse or any server-side CSV validation (the wire carries row objects; unchanged).
- `.xlsx` / Excel workbook support; `;`- or tab-delimited files; delimiter sniffing; encodings other than UTF-8.
- Any change to `ImportBatchWireBody`, `ImportRejectReason`, `ImportRowReject`, `preview-rejections-panel`,
  `commit-rejections-*`, the preview lookups, or the commit path.
- Rejecting blank-`phone` rows (today silently skipped) — candidate follow-up, see Risks.
- Migrating the two existing Blob-download copies onto `src/lib/download-csv.ts`.
- A localized (zh-HK) template file — one template; the header is the parser contract and must be English.
- Web-worker parsing — not needed within budget.

## Risks & Open Questions

- **R-1 Preview wording.** After parse rejections, the preview step's `preview.rejectedNone` still reads
  "No rows rejected. N contacts ready" (counts are right, wording narrower). Recommended: leave. Cheap
  follow-up if product wants it: pass `csv.rejected.length` to the preview step and add one line.
- **R-2 Unterminated quote swallows the rest of the file** into one rejected record by design. The message
  explains it and names the line; the operator fixes and re-uploads. Alternative (file-level error) rejected
  because row-level keeps one rejection contract and shows the surviving rows.
- **R-3 Blank phone rows** stay silently skipped (existing). A `missing_phone` reason would be a one-line
  addition to the same panel; deferred to keep AC-18.5 literal. Caller may pull it in.
- **R-4 Lenient quote handling** (AD-1) accepts some non-RFC inputs without complaint. Deliberate: those
  inputs cannot shift columns. If a reviewer prefers strictness, add reasons — the panel is generic.
- **R-5 `Blob.text()` and the BOM.** Conforming browsers strip a leading BOM during UTF-8 decode; the
  tokeniser strips it anyway so behaviour never hinges on the caller. I-1 should still upload a real
  Excel-exported CSV if one is at hand.
- **R-6 Concurrency in one worktree.** A1 ∥ B1 is safe only because B1 owns new files exclusively; if the
  orchestrator prefers zero risk, run A1 → B1 → A2 sequentially (total dev time is small).
- **R-7 Number formatting.** `{maxRows}` renders via next-intl number formatting ("50,000"); the existing
  `csv.errors.tooManyRows` uses the same mechanism. I-1 confirms in both locales.
- **R-8 Example phone numbers** in the template are the `+852 9123 45xx` style already used across this
  repo's tests; they are not verified unassigned. If the caller wants guaranteed-fictional numbers, swap
  them — the round-trip test pins whatever is chosen.
- **R-9 Workspace rot (report, not repaired).** The worktree's `.claude-workspace/` lacks several artifacts
  its `INDEX.md` lists (e.g. `plans/2026-08-28-tag-001-issues-138-139.md`, the whole `tests/` folder) —
  they are untracked in the primary checkout. This plan was written against the primary copy of the
  TAG-001 plan. The orchestrator should decide whether to commit those artifacts.
- **Q-1 (caller)** Help block always visible vs collapsible `<details>`? Plan says always visible (five
  short lines, sparse step). Reverse without structural change if preferred.

## Appendix A — i18n keys (T0 adds verbatim, both locales, inside `importWizard.csv`)

| Key | en | zh-HK |
|---|---|---|
| `csv.description` (**modify**) | Upload a CSV with at least a phone column. Download the template below for the exact format, or follow the rules here. | 上載至少包含 phone 欄的 CSV。可下載下方範本以取得正確格式，或按以下規則準備檔案。 |
| `csv.downloadTemplate` | Download CSV template | 下載 CSV 範本 |
| `csv.help.title` | CSV format | CSV 格式 |
| `csv.help.phone` | phone — required. Full international number with country code, e.g. +85291234567. The header may also be phonee164 or phone_e164. | phone — 必填。完整國際電話號碼（含國家代碼），例如 +85291234567。欄名亦可用 phonee164 或 phone_e164。 |
| `csv.help.name` | name — optional. The header may also be fullname. If a name contains a comma, wrap it in double quotes: "Chan, Tai Man". | name — 選填。欄名亦可用 fullname。姓名含逗號時請用雙引號包住："Chan, Tai Man"。 |
| `csv.help.language` | preferred_language — optional. Only en or zh_hk are accepted; any other value is imported as blank. The header may also be language or lang. | preferred_language — 選填。只接受 en 或 zh_hk；其他值會當作空白匯入。欄名亦可用 language 或 lang。 |
| `csv.help.tags` | tags — optional. Separate tags with a semicolon, e.g. VIP;Lunch. Up to {maxTagsPerRow} tags per row, 40 characters per tag, and 50 new tags per import. The header may also be tag. | tags — 選填。多個標籤以分號分隔，例如 VIP;Lunch。每列最多 {maxTagsPerRow} 個標籤、每個標籤最多 40 個字元、每次匯入最多新增 50 個標籤。欄名亦可用 tag。 |
| `csv.help.limits` | Up to {maxRows} rows per file. Column order does not matter and header names are not case-sensitive. | 每個檔案最多 {maxRows} 列。欄位次序不限，欄名不分大小寫。 |
| `csv.rejectedTitle` | {count} rows could not be read and will not be imported | {count} 列無法讀取，將不會匯入 |
| `csv.rejectLine` | Line {line} | 第 {line} 行 |
| `csv.reason.column_count_mismatch` | Expected {expected} columns but found {actual} — check for a comma inside a name or tag that is not wrapped in double quotes | 預期 {expected} 欄，但讀到 {actual} 欄——請檢查姓名或標籤內是否有未用雙引號包住的逗號 |
| `csv.reason.unterminated_quote` | A double quote opened on this line was never closed, so everything after it was read as one cell | 此行的雙引號沒有關閉，其後的內容全部被讀成同一格 |
| `csv.showingFirst` | Showing the first {shown} of {count} | 僅顯示首 {shown} 筆，共 {count} 筆 |

Existing keys `csv.pick`, `csv.rowCount`, `csv.errors.*`, `csv.tagsFound`, `csv.tagsIgnored` are unchanged.
The JSON nesting is `csv.help.{title,phone,name,language,tags,limits}` and `csv.reason.{…}` as objects.

## Appendix B — template content (B1 pins this verbatim; T-B1.4 pins the parse)

`IMPORT_TEMPLATE_CSV` = `'﻿'` + the following lines joined with `\r\n` (trailing `\r\n` after the
last row):

```
phone,name,preferred_language,tags
+85291234567,Chan Tai Man,zh_hk,VIP;Lunch
+85291234568,"Chan, Tai Man",zh_hk,VIP
+85291234569,陳大文,zh_hk,
+85291234570,Jane Doe,en,Dinner
```

Expected round-trip rows (in order):

```ts
[
  { phoneE164: '+85291234567', name: 'Chan Tai Man',  preferredLanguage: 'zh_hk', tags: ['VIP', 'Lunch'], ignoredTagCount: 0 },
  { phoneE164: '+85291234568', name: 'Chan, Tai Man', preferredLanguage: 'zh_hk', tags: ['VIP'],          ignoredTagCount: 0 },
  { phoneE164: '+85291234569', name: '陳大文',         preferredLanguage: 'zh_hk', tags: [],               ignoredTagCount: 0 },
  { phoneE164: '+85291234570', name: 'Jane Doe',      preferredLanguage: 'en',    tags: ['Dinner'],       ignoredTagCount: 0 },
]
```

Row 2 demonstrates quoting; row 3 demonstrates UTF-8 (why the BOM matters for Excel) and a trailing empty
field; the set exercises both languages and `;` tags.

## Appendix C — tokeniser specification (A1 implements; this is the spec, not code)

Input: `text: string`. If `text.charCodeAt(0) === 0xFEFF`, start at index 1. Maintain `i` (cursor),
`line` (starts at 1), `recordStartLine`, `cells: string[]`, `cell` accumulator (or slice indices),
`inQuotes`, `quotedCell` flag.

States and transitions (per character `c`):
- **Field start**: skip spaces/tabs; if `c === '"'` → enter quoted (`quotedCell = true`), else unquoted.
- **Quoted**: `"` followed by `"` → append one `"`, advance 2; `"` followed by anything else → leave quoted
  (subsequent chars until `,` / terminator are appended literally); `\n` → append, `line++`; `\r` →
  append `\n` semantics only if not followed by `\n` (normalise), `line++`; else append.
- **Unquoted**: `,` → push cell, field start; `\r\n` / `\n` / lone `\r` → push cell, end record, `line++`;
  else append (a `"` here is literal).
- **EOF**: if inside quoted → push cell, end record with `unterminated: true`; else if the current record has
  any content or more than one cell → push cell, end record.
- **End record**: if `cells.length === 1 && !quotedCell && cells[0].trim() === ''` → discard (blank line);
  else emit `{ line: recordStartLine, cells, unterminated }`. Reset `recordStartLine = line`.

Guarantees: O(n) single pass; no regex in the loop; the number of emitted records equals the number of
non-blank logical records; `line` on each record is the physical 1-based line of its first character
(header = 1); every `\r\n` counts as one line.
