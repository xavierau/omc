---
id: tests/2026-08-28-wonb-018-019-ui-verification
type: test
author: ui-test-runner
created: 2026-08-28
status: active
supersedes: null
superseded_by: null
related: [kanban:WONB-018, kanban:WONB-019, github:148, github:147, plans/2026-08-28-wonb-018-019-csv-parser-and-template]
---

# WONB-018 + WONB-019 UI Verification — #148 CSV parser rejections + #147 template/help

## Environment

- **env**: dev, `http://localhost:3000` (worktree `whatsapp-crm-wonb-018-worktree`, branch `feature/wonb-018-issues-147-148` @ `8e01c56`)
- **Active org**: `00000000-0000-4000-a000-000000000001` ("The Green Kitchen") — confirmed via `x-tenant-id` cookie (identity pin, §identity pin below)
- **Browser**: Chrome DevTools MCP (`mcp__chrome-devtools__*`)
- **Breakpoints run**: desktop 1440×900, mobile 390×844. Tablet — not run (dispatch scoped `layout scope: default`)
- **Locale rendered**: zh-HK (server default). `en` not browser-run this session — covered by unit tests per dispatch note.

**Server note (environment, not product):** the dev server was up but every route 500'd on arrival — a corrupted Turbopack persistent cache (`.next/dev`: "Persisting failed: Unable to write SST file", "Another write batch or compaction is already active"). Killed the two `next dev` processes, `rm -rf .next`, restarted (`PORT=3000 ./node_modules/.bin/next dev -p 3000`); `/login` returned 200 within ~6s. The orchestrator separately restarted its own instance mid-run (message received); the final server used throughout functional testing was the orchestrator's (PID 17205), confirmed healthy (`/login` 200, `/dashboard` 307) before proceeding.

## Identity pin

`document.cookie` → `x-tenant-id=00000000-0000-4000-a000-000000000001` — matches `environments.md` testOrgId for dev. Pin confirmed before any interaction; no mismatch.

## Reachability (app entry point)

Real-UI path exercised once (not deep-linked) to satisfy entry-point reachability, before switching to the dispatch-sanctioned `?step=csv` deep link for the CSV-step checkpoints:

1. Login (recipe A) → `/dashboard` (zh-HK dashboard renders, nav visible).
2. Click `/dashboard/members` nav link → member list itself fails (`GET /api/dashboard/tags` 500, `GET /api/dashboard/members?...` 500 — dev DB lag, `tags` table missing; env gap #146, matches `env-policy.md`). The "匯入聯絡人" (Import Contacts) link was visible on this page before the list-load error replaced the content.
3. Navigated directly to `/dashboard/members/import` → wizard renders step 1 "批次資料" (batch metadata) with the 4-step indicator (批次資料 / 上載 CSV / 預覽與評級 / 確認) — confirms the wizard and its CSV step are reachable from the app entry point.
4. Switched to `?step=csv` (dispatch-sanctioned deep link — metadata step is out of scope for this feature) for the remaining checkpoints.

## Scenarios run

| Scenario | State | Observed feedback | Result | Notes |
|---|---|---|---|---|
| Upload step — empty | initial | `[data-step="upload-csv"]` renders; `[data-section="csv-help"]` = title + 5 lines (zh-HK, interpolated numbers); `[data-action="download-template"]` present; `[data-action="next"]` disabled; no rejections section | PASS | see number-formatting finding below |
| Download CSV template | success | Blob download, `download="import-template.csv"`, `text/csv;charset=utf-8;`, 186 bytes, 0 network requests | PASS | BOM (`EF BB BF`) confirmed at byte level via `ArrayBuffer`; header + 4 rows exact match Appendix B |
| Upload `bad.csv` (unquoted comma) | rejected | `[data-section="csv-parse-rejections"]` visible, one `<li data-reject-reason="column_count_mismatch" data-reject-line="2">` = "第 2 行 · +85290001234 · 預期 4 欄，但讀到 5 欄——請檢查姓名或標籤內是否有未用雙引號包住的逗號"; no `[data-info="row-count"]`; `[data-action="next"]` disabled (opacity 0.5 confirmed); no empty-error text | PASS | exact zh-HK string match to Appendix A `csv.reason.column_count_mismatch` |
| Upload `good.csv` (quoted) | accepted | `[data-info="row-count"]` = "1 列已準備評級"; `[data-info="tags-found"]` = "此檔案中找到 1 個標籤"; rejections panel gone; Next enabled | PASS | |
| Upload captured `template.csv` | accepted | "4 列已準備評級", "此檔案中找到 3 個標籤" (VIP, Lunch, Dinner), no rejections | PASS | round-trips the exact downloaded template |
| Click Next (preview hop) | — | `POST /api/dashboard/imports/preview` → 400 `{"error":"dateRangeStart is not a valid date"}` | not applicable (recorded, not a defect) | Not the dev-DB-lag gap (#146) — caused by intentionally skipping the batch-metadata step via deep link (source/dateRange/consent fields empty). **Evidence bonus**: wire body's `rows[]` contained exactly the 4 accepted template rows and nothing from the rejected row — confirms AC-18.3 ("rejected rows can never be posted") at the network layer. Stopped here per dispatch; did not fill metadata, did not commit an import. |

All functional assertions specified in the dispatch (steps 3–7) pass exactly as written.

## Layout / Visual Review

Breakpoints run: desktop 1440×900 · mobile 390×844 · tablet — not run (`layout scope: default`)
Screens audited: 3 checkpoints (empty / rejected / accepted) × 2 breakpoints = 6, each DOM-audited (`window.__layoutAudit()`) and screenshotted.

| # | breakpoint | screen / state | check | element | detail | sev | status | evidence |
|---|---|---|---|---|---|---|---|---|
| 1 | desktop | upload-csv (empty/rejected/accepted, all 3) | row-misaligned | `div.flex.min-h-screen` → `aside.bg-sidebar` vs `main.flex-1` | full-height sidebar (900px) vs intrinsic-height main content in the same flex row; spread 300–480px | warning | downgraded: legitimate app-shell pattern (fixed full-height nav sidebar beside intrinsic-height content) — confirmed clean via screenshot, no visual defect | screenshots/upload-empty-desktop.jpeg |
| 2 | mobile | upload-csv (all 3 states) | touch-target-small | `button.text-xs.text-muted-foreground "下載 CSV 範本"` @274,191 80×16 | interactive target below 24×24px (WCAG 2.5.8) | warning | confirmed (screenshot shows a small underlined text-link style button, not a padded tap target) | screenshots/upload-empty-mobile.jpeg |
| 3 | mobile | upload-csv (all 3 states) | touch-target-under-44 | 4 unnamed targets, 24–44px | below 44px comfort size | info | not individually pinned by the audit (aggregate only) | — |

CLS: 0 at every checkpoint. Overlays seen: none.
Baselined: 0 (`layout-baseline.md` is empty). Proposed baseline entries: `div.flex.min-h-screen (sidebar app-shell) | row-misaligned | full-height nav sidebar vs intrinsic-height main content — intentional shell layout, not a defect | 2026-08-28`.

**Missed-by-audit finding (from screenshot + direct check, not a geometry issue so the DOM audit does not catch it):** the help line "每個檔案最多 **50000** 列" (zh-HK) renders the row limit as a bare `50000`, not comma-grouped. The plan's own R-7 risk note states `{maxRows}` should render via next-intl number formatting to match `csv.errors.tooManyRows`'s existing mechanism, and `new Intl.NumberFormat('zh-HK').format(50000)` in the same page context returns `"50,000"` — so the browser/locale is capable of the grouped form, but the interpolated string is not using it. Confirmed present identically at desktop and mobile, in all three states (the string is static, not state-dependent). Non-blocking (readability only, does not affect any functional assertion), but is a real deviation from the plan's stated intent — flagged for the dev/review gate, not auto-fixed.

## Perf

No perf budgets named in this dispatch. The plan's `parseCsv` timing budgets (≤500ms/750ms on 50,000 rows) are unit-test-level (`T-A1.perf`) and were not re-measured in-browser this run — appropriate for vitest, not a browser walk. Template-download click was instant with 0 network requests (qualitative pass against the plan's "<50ms, 0 network requests" budget, not stopwatched).

## Anomalies

- `GET /api/dashboard/tags` [500], `GET /api/dashboard/members?...` [500] on `/dashboard/members` — expected dev-DB-lag environment gap (#146, `env-policy.md`), not a WONB-018/019 defect.
- `POST /api/dashboard/imports/preview` [400] `dateRangeStart is not a valid date` — expected given the intentionally-skipped metadata step (see Scenarios table); not a defect, and evidentially useful (confirms rejected rows never reach the wire).
- Console `[issue]` "No label associated with a form field" (×7) and "A form field element should have an id or name attribute" (×6) — observed on the batch-metadata step (step 1) during the entry-point reachability walk. Pre-existing accessibility gaps on the metadata form, outside WONB-018/019's scope (which touches only the upload-csv step) — reported, not investigated further.
- No other console errors or failed requests on the upload-csv step itself across all 6 audited checkpoints.
- zh-HK confirmed rendering at every checkpoint (server default locale); `en` not exercised in-browser this run.

## Cleanup

- No import was committed; no members, tags, or import batches were created by this run.
- Fixture files (`bad.csv`, `good.csv`, `template.csv`) were written to the session scratchpad and to a temporary staging path in the main checkout (`/Users/xavierau/Code/js/whatsapp-crm/.claude-workspace/tests/fixtures-tmp/` — needed because the browser MCP's file-access roots are bound to the main checkout, not this worktree or the scratchpad); the staging copies and the empty `screenshots/` directory they created were removed after use, restoring the main checkout to its prior state. Evidence screenshots were moved into this worktree's `tests/screenshots/` (see below).
- The throwaway dev user `ui-test-wonb018@example.com` (per `secrets.local.json`) still exists — this run did not create or delete it. Per `env-policy.md` it should be deleted once all WONB-018/019 verification is complete; not done here since other verification steps may still depend on it.
- Dev server: restarted once (corrupted cache, see Environment note) with a clean `.next`; left running (now the orchestrator's later-restarted instance) for any follow-on work.

## UI Map changes (auto-write)

All confirmed by a passing interaction this run:

- `testid-registry.md`: added `[data-step="upload-csv"]`, `[data-section="csv-help"]`, `[data-action="download-template"]`, `[data-action="pick-csv"]`, `[data-action="next"]`, `[data-section="csv-parse-rejections"]`, `li[data-reject-reason][data-reject-line]`, `[data-info="row-count"]`, `[data-info="tags-found"]` for the import-wizard upload-csv step.
- `flows/wonb-018-019-csv-import-upload-step.md`: new flow doc — deep-link URL, per-state assertions, fixture recipe (unquoted vs quoted comma), template round-trip method (Blob interception).
- `layout-baseline.md`: **not written** (never auto-written) — see the proposed entry above for the caller to accept.

## Verdict

**PASS.** All dispatch-specified assertions (steps 1–7) confirmed exactly as written; step 8 (preview hop) recorded and correctly stopped short of committing, with a useful-but-unplanned confirmation of AC-18.3 at the network layer. No blocking layout findings at either breakpoint. Two non-blocking findings for the dev/review gate to consider: (1) the "下載 CSV 範本" button is a sub-24px tap target on mobile (WCAG 2.5.8), (2) the `{maxRows}` help line renders `50000` without thousands-grouping, contrary to the plan's own R-7 note. Neither blocks acceptance.
