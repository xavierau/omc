# Flow: Member import wizard — CSV upload step (WONB-018 parse rejections + WONB-019 template/help)

Confirmed 2026-08-28 (dev, run `tests/2026-08-28-wonb-018-019-ui-verification.md`).

## Reach

Real nav: login (recipe A) → `/dashboard/members` (may show a data-load error on dev due to the DB-lag
env gap, #146 — the "匯入聯絡人" link is present before that error replaces the list) →
`/dashboard/members/import` (step 1, batch metadata) → step 2 is `?step=csv`.

**Deep link** (client-only, no DB dependency): `/dashboard/members/import?step=csv` reaches the upload
step directly, skipping the batch-metadata form. Safe for repeat regression runs of this step; use the
real-nav path above at least once per larger verification pass to keep entry-point reachability honest.

## States and selectors

| state | trigger | assertions |
|---|---|---|
| empty | initial load | `[data-step="upload-csv"]`; `[data-section="csv-help"]` (title + 5 help lines + `[data-action="download-template"]`); `[data-action="pick-csv"]`; `[data-action="next"]` disabled; no `[data-section="csv-parse-rejections"]` |
| download template | click `[data-action="download-template"]` | Blob download, `download="import-template.csv"`, `text/csv;charset=utf-8;`, starts with UTF-8 BOM (`EF BB BF`), header `phone,name,preferred_language,tags`, 4 example rows (row 2 quoted `"Chan, Tai Man"`, row 3 `陳大文`), CRLF line endings, 0 network requests. `Blob.text()` strips the BOM per browser UTF-8 decode — check bytes via `blob.arrayBuffer()` if the BOM itself needs asserting. |
| rejected | upload a CSV with a data row whose cell count ≠ header count (e.g. unquoted comma inside a name) | `[data-section="csv-parse-rejections"]` visible; one `li[data-reject-reason="column_count_mismatch"][data-reject-line="N"]` per bad row, text = `第 {line} 行 · {phone} · 預期 {expected} 欄，但讀到 {actual} 欄——請檢查姓名或標籤內是否有未用雙引號包住的逗號` (zh-HK); no `[data-info="row-count"]` when zero rows survive; `[data-action="next"]` stays disabled |
| accepted | upload a well-formed CSV | `[data-info="row-count"]` (zh-HK: `{n} 列已準備評級`); `[data-info="tags-found"]` when any row carries a tag (`此檔案中找到 {n} 個標籤`); no rejections panel; `[data-action="next"]` enabled |

## Fixture recipe

- Bad (unquoted): `phone,name,preferred_language,tags\n+85290001234,Chan, Tai Man,zh_hk,VIP\n`
- Good (quoted): `phone,name,preferred_language,tags\n+85290001234,"Chan, Tai Man",zh_hk,VIP\n`
- Template round-trip: capture the downloaded Blob (see download-template row above) and re-upload it —
  should parse to 4 rows, 3 distinct tags (VIP, Lunch, Dinner), zero rejections.

## Known non-blocking findings (2026-08-28)

- `[data-action="download-template"]` renders as an 80×16px text-link button on mobile — below the WCAG
  2.5.8 24×24px minimum touch target.
- The help line `每個檔案最多 {maxRows} 列` renders `50000` without thousands-grouping in zh-HK
  (`Intl.NumberFormat('zh-HK').format(50000)` in the same page context returns `"50,000"`, so the
  capability exists but isn't used for this interpolation).

## Preview hop (out of scope for this flow)

Clicking Next posts to `POST /api/dashboard/imports/preview`. On dev, going straight from this deep link
(skipping the batch-metadata step) returns 400 `dateRangeStart is not a valid date` — expected, not a
defect of this flow. Useful side-evidence: the wire body's `rows[]` contains only the accepted rows;
rejected rows are never posted.
