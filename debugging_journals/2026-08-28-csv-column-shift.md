# 2026-08-28 — CSV import: a comma inside a quoted name silently shifted every later column (#148)

## Problem
`parseCsv` (`src/components/dashboard/import-wizard/parse-csv.ts`) split each line with a bare
`line.split(',')`. There was no quoted-field handling and no column-count check, so a row such as

```csv
phone,name,preferred_language,tags
+85290001234,"Chan, Tai Man",zh_hk,VIP
```

tokenised to `['+85290001234', '"Chan', ' Tai Man"', 'zh_hk', 'VIP']`. `phone` survived (it precedes
the shift); `name` became `"Chan`; `preferred_language` received `Tai Man"` and was coerced to
`null` by `normaliseLang`; `tags` received `zh_hk`, so a junk tag literally named `zh_hk` was minted
in the tenant. The row then reported as a **successful** import — nothing reached the rejection
list, so the operator had no signal. Contact lists exported from POS systems or Excel commonly carry
`"Surname, Given name"`, and the `tags` column shipped by TAG-001 gave the shift a place to land.

A second, worse defect was the file's own header comment: *"Server-side parser remains the source
of truth at commit time."* That was false. The client posts already-parsed row objects
(`ImportBatchWireBody.rows` in `src/app/api/dashboard/imports/_shared.ts`); the server never
receives the CSV text and nothing downstream re-checks column alignment. The client parser was the
**only** parser, and the comment invited reviewers to assume a second line of defence that did not
exist.

No prod data was affected: `import_batch`, `tags` and `member_tags` were all empty when the audit
that filed #148 ran.

## Root cause
1. A deliberately minimal MVP parser ("avoids adding a heavy dep") whose known limitation was
   documented but never revisited when the column layout grew (`preferred_language`, then `tags`).
2. No validation that a data row has the same number of cells as the header, so a malformed row
   degraded into wrong-but-plausible values instead of an error.
3. A stale architectural claim in the header comment that made the gap look covered.

## Solution
- **`csv-tokenizer.ts` (new)** — a zero-dependency RFC 4180 state machine: one `charCodeAt` pass,
  quoted fields, `""` escapes, commas and newlines inside quotes, `\r\n` / `\n` / lone `\r`
  terminators, and a leading UTF-8 BOM (Excel exports carry one; previously `﻿phone` failed
  the header match). Each record carries its physical 1-based `line` and an `unterminated` flag
  (EOF reached inside a quoted field).
- **`parse-csv.ts`** — now returns `ParseCsvResult { phoneHeaderFound, rows, rejected }`. A data
  record is rejected with `unterminated_quote` (checked first) or `column_count_mismatch`
  (`cells.length !== header.cells.length`, fewer **and** more — fewer is ambiguous and index-mapping
  it would silently misalign; trailing empty fields still tokenise to N and are accepted) **before**
  any mapping runs, so a shifted row can never reach `normalizeImportTags` and can never be posted
  (rejected rows are not in `rows`). Blank-phone rows are still skipped silently, as before. The
  header comment now states that the client parser is the only parser.
- **`step-upload-csv-helpers.ts` (new)** — `MAX_ROWS` has one definition; `classifyParseResult`
  keeps the `csv.errors.empty` / `csv.errors.tooManyRows` paths and makes "rows only in `rejected`"
  an `ok` outcome (the panel, not the empty error), with rejected rows not counting toward the cap.
- **`csv-parse-rejections.tsx` (new, #147 wiring)** — the upload step lists every rejected row with
  its line number, phone (when readable) and reason, capped at 500 like the preview panel; Next stays
  disabled when nothing survived.
- **Template + help (#147)** — the upload step now offers a downloadable `import-template.csv`
  whose second row is the quoted `"Chan, Tai Man"` case, and a round-trip unit test pins
  `parseCsv(IMPORT_TEMPLATE_CSV)` to the exact expected rows with zero rejections.

Tests: `csv-tokenizer.test.ts` (fixtures for every RFC 4180 case above + a 50,000-row O(n²) guard),
`parse-csv.test.ts` (the #148 row quoted → correct row; unquoted → rejected `line 2, expected 4,
actual 5`, and a proof that no `zh_hk` tag can be minted), `step-upload-csv-helpers.test.ts`.

Review-round hardening (gemini + grok + qa-engineer + ui-test-runner + recovered `/code-review` finders,
`reviews/2026-08-28-wonb-018-019-*`): an unterminated quote on the header line is named as line 1
(checked before alias matching); a quote opened in the *phone* column no longer dumps the rest of the
file into the panel (`rejectPhone`); a line break inside a quoted name collapses to a space and inside
a tags cell acts as a separator (a newline would otherwise reach `members.name` → WhatsApp template
parameter, or be minted as a tag name); NBSP / U+3000 before an opening quote are skipped; the
mismatch hint is direction-aware; the file input resets so a fixed file can be re-picked; an
unreadable file shows `csv.errors.unreadable`. Cell helpers live in `parse-csv-cells.ts`.

## Prevention
- **A parser that cannot fail is a data-corruption path.** Any intake parser must have a rejection
  channel; "malformed input degrades into plausible values" is the failure mode to test for
  explicitly (feed the unquoted #148 row and assert it is *rejected*, not merely parsed).
- **Comments that describe a safety net are claims about the repo — verify them at review.** Trace
  the wire contract: if the server receives parsed objects, there is no server-side parse, whatever
  the comment says.
- **When a column is added to a CSV contract, re-run the parser's known-limitation list.** The
  `tags` column was the third column after `name`; the shift needed exactly that.
- Related principle memory: `principle_verify_issue_claims_before_planning` (the repo's comments
  are claims, not evidence).
