---
id: artifacts/2026-11-26-build-font-001-handoff
type: handoff
contract: handoff-file-v1
author: dev
created: 2026-11-26
status: active
supersedes: null
superseded_by: null
related: [deploys/2026-11-26-book-012-release-runbook, kanban:BOOK-012, kanban:TPL-012]
item: BUILD-FONT-001
state: done
brief: inline
base: 0715b4eb
head: 47efe920
branch: fix/build-noto-sans-hk-font
pushed: true
gate: {result: none, at: none}
next: {owner: main, action: "review and merge PR #231 into develop, then resume the BOOK-012 release from the merged tip"}
blockers: []
refs: [github:231, deploys/2026-11-26-book-012-release-runbook, artifacts/2026-11-26-build-font-001-evidence]
---
ac:
  AC-1: pass   # 0c41a4df builds; root cause reproduced 1:1 by mock (ac1-*.log)
  AC-2: pass   # heavy-lock next build exit 0 on fix branch, also with the failing response mocked in (ac2-build-fix.log)
  AC-3: fail   # as written: real CJK elements compute Inter -> PingFang (system), identical to prod; --font-cjk -> Noto shown by probe; 0 font 404s; screenshots byte-identical
  AC-4: pass   # heavy-lock tsc --noEmit exit 0 (ac4-tsc.log)
  AC-5: pass   # pushed (ls-remote == HEAD), PR #231 into develop
decisions:
  - "Declare Noto Sans HK in src/app/fonts/noto-sans-hk.css (Google rules verbatim, gstatic URLs) instead of next/font/google; no font binaries added (self-host = +5.3 MB for an unused face; <link> = 424 KB render-blocking third-party CSS)"
  - "AC-3 not forced: applying --font-cjk to CJK text changes every zh page (PingFang -> Noto), against the brief's keep-the-render"
  - "Inter left on next/font/google (not in the failure; same failure class) — main decides a follow-up"
failed:
  - "chrome-devtools MCP refused (profile in use by another agent); used playwright-core with cached Chromium 1208 in scratch instead"
invariants:
  - "--font-cjk on <html> is \"Noto Sans HK\", \"Noto Sans HK Fallback\" before and after"
  - "Inter stays --font-sans via next/font/google"
  - "No package.json, lockfile, Next or bundler change"
unverified:
  - "The exact css2 body Google sent Turbopack at 04:36-04:42Z was not captured; the &-URL form is inferred from the code path (only & splits the qstring) and the 1:1 mock repro"
  - "debugging_journals/ entry not written (outside files_allowed); text is in the Journal section below"
review_focus:
  - "src/app/fonts/noto-sans-hk.css :root rule vs Tailwind's layered --font-cjk theme var (unlayered :root wins)"
  - "424 KB CSS file committed (Google response verbatim)"
scope_drift: []
next_step: "Merge PR #231 into develop, then rerun release.sh from the merged main tip (release-book012 lacks the fix)."


# BUILD-FONT-001: unblock `next build` (Noto Sans HK, next/font/google)

Stage: POC (no `WT_STAGE`, and the repo does not import `stages/mature.md`). Tree `../whatsapp-crm--build-font`,
branch `fix/build-noto-sans-hk-font` from `0715b4eb`. Evidence: `artifacts/2026-11-26-build-font-001-evidence/`.
All times are UTC, 2026-11-26.

## Root cause (AC-1)

**Mechanism (reproduced).** `next/font/google` fetches the css2 stylesheet from Google during the build. Turbopack
then rewrites every font URL in it to `@vercel/turbopack-next/internal/font/google/font?<query>`, where `<query>`
is `qstring::QString::from(serde_json::to_string({url, preload, has_size_adjust}))`. In next 16.3.4 that is
`crates/next-core/src/next_font/google/mod.rs` line 488. When the CSS is resolved, the query is parsed again with
`QString::from`, and anything other than exactly one entry fails with `bail!("next/font/google queries have exactly
one entry")` (lines 638–642). `QString` splits on `&`, and `preload` and `has_size_adjust` are booleans. So the
build fails this way exactly when the font URL itself contains `&`. Google does serve URLs of that form:
`https://fonts.gstatic.com/l/font?kit=…&skey=…&v=v36`. Today it serves them for a `text=` request on Noto Sans HK.
- Repro: `0c41a4df` built with `NEXT_FONT_GOOGLE_MOCKED_RESPONSES` set to today's real Noto + Inter responses gives
  exit 0. With each Noto URL rewritten to the `/l/font?kit=<id>&skey=<k>&v=v36` form it gives exit 1. The failure
  is the release failure line for line: `Turbopack build failed with 327 errors`, and 327× `Module not found: Can't
  resolve '@vercel/turbopack-next/internal/font/google/font'`, 327× `Error while looking up import map`, 654×
  `- next/font/google queries have exactly one entry`, all in `noto_sans_hk_5e297ec2.module.css`. The release.sh
  try-2 log has the same five counts (`ac1-mock-repro.log`).

**Trigger (external, transient; inferred).** The same tree builds now:
- `0c41a4df` (prod): exit 0 at 04:47:57–04:48:36Z (`ac1-build-0c41a4df.log`).
- `0715b4eb`: exit 0 at 04:48:42–04:49:23Z. Its tree is `51e41efe`, the same as the release's `main@38399078`.
- A full `RELEASE_DRY_RUN=1 scripts/release.sh` on it (`npm ci`, `rm -rf .next`, `npm run build`, stage, scrub,
  scan): exit 0, started 04:50:05Z (`ac1-build-base-and-release-dryrun.log`).

Code, lockfile and Next binary are the same as in the failed 04:36Z and 04:42Z runs. The only input that varies is
Google's css2 response to Turbopack's fetch (UA `Chrome/104.0.0.0`). By the mechanism above, that response must
have carried `&` in all 327 Noto URLs and not in Inter's. Inter was not in the errors. What Google actually sent
at 04:36–04:42 was not captured: Turbopack does not keep it, and the release agent's 04:37 curl used a current
Chrome UA. My fetches with Turbopack's UA from 04:55 on return the normal `/s/notosanshk/v36/*.woff2` form (md5
`c5563328…`, 3/3 identical). So this is a Google-side change that can come back at any build, not a regression
in this repo.

`0c41a4df` builds, so the brief's bisect branch was moot. There is no BOOK-012/TPL-012 commit to blame.

## Fix

`src/app/layout.tsx` stops loading Noto Sans HK through `next/font/google` and imports
`src/app/fonts/noto-sans-hk.css` instead:
- That file holds `:root { --font-cjk: "Noto Sans HK", "Noto Sans HK Fallback" }`. This is the exact value next/font
  set on `<html>`.
- It also holds next/font's generated `Noto Sans HK Fallback` face (the Arial metrics) and Google's css2 response
  for `wght@400;500;700`, verbatim: 327 faces with unicode-range slices, notosanshk v36. The OFL 1.1 note is in the
  file header.
- Nothing in that path is fetched at build time, so Google's response format can no longer fail the build. Inter
  stays on `next/font/google` as `--font-sans`.

Why this option:
- **Smallest change that keeps the render.** Two files, no binaries. See "Render today" below.
- **Self-hosting rejected:** it means 109 unique woff2 slices, +5.3 MB of binaries in a public repo (the base
  build's `static/media` is 5.6 MB, the fix build's 252 KB), for a face no element uses.
- **A `<link>` to fonts.googleapis.com rejected:** it adds a render-blocking third-party request for 424 KB of CSS
  on every page.

Size: the app's global CSS chunk goes from 354,949 to 379,205 bytes (+24 KB raw), because gstatic URLs are longer
than `/_next/static/media` paths. The build no longer emits the 109 Noto woff2 files, and pages lose the Noto
latin-slice preload (2 font preloads → 1).

## Render today, and AC-3 as written

Measured with the CDP platform-font check (`ac3-check.js.txt`, Chromium 1208, 1440×900, `/login` in zh-HK):
- **On the current build, no element uses `--font-cjk`.** `html` is `font-sans` (Inter), and no component uses a
  `font-cjk` utility or `var(--font-cjk)`. Every CJK string is laid out in **PingFang TC (system)**. Not a single
  Noto face loads.
- This is the same on base and fix (`render-base.json` / `render-fix.json`). The two screenshots are
  **byte-identical** (`ac3-login-zh-base.png` = `ac3-login-zh-fix.png`). 0 font 404s, 0 failed requests and 0
  third-party requests on both.
- AC-3 as written ("computed font-family of a CJK element includes the Noto face") is false before and after this
  change. Making it true means applying `--font-cjk` to CJK text, which changes every zh page from PingFang to
  Noto. That conflicts with the brief's "keep the rendered result", so I did not do it (see Decide in the report).
- What `--font-cjk` resolves to is proven on the fix build:
  - `--font-cjk` on `<html>` is `"Noto Sans HK", "Noto Sans HK Fallback"` (identical to base), with 328 Noto faces
    declared.
  - A probe element set to `font-family: var(--font-cjk)` at 400/500/700 renders with the **Noto Sans HK web
    font** (CDP reports the variable file's default instance name "Noto Sans HK Thin"; the weights render
    distinct, `ac3-font-cjk-probe-fix.png`).
  - The files load from fonts.gstatic.com with 6/6 responses 200.

## Acceptance

| id | result |
|---|---|
| AC-1 | `0c41a4df` builds (exit 0). Root cause: Turbopack's `&`-unsafe font-URL query plus a Google css2 response with `&` in the Noto URLs. Reproduced 1:1 by mock, see above |
| AC-2 | `resource-lock.py heavy -- npx next build` on the fix branch: exit 0 (05:02:08–05:02:37Z). Also exit 0 **with the failing `&` response mocked in**, which shows the fix removes the failure class (`ac2-build-fix.log`) |
| AC-3 | partial, by design: screenshot, 0 font 404s, `--font-cjk` → Noto shown by probe. Computed font-family of real CJK elements is Inter → PingFang, unchanged from prod (see above) |
| AC-4 | `resource-lock.py heavy -- npx tsc --noEmit` on the fix branch: exit 0 (`ac4-tsc.log`) |
| AC-5 | PR into develop, see the handoff block |

## Journal (debugging_journals/ is outside files_allowed; the content is here for main to file)
- Problem: release.sh `next build` failed 2/2 (04:36Z, 04:42Z) with 327 Turbopack `next/font/google` errors for
  Noto Sans HK.
- Root cause: the mechanism above, triggered by Google's response.
- Fix: the Noto faces are declared in CSS, with no build-time Google fetch.
- Prevention:
  - Any `next/font/google` family can fail this way, Inter included.
  - When a build fails inside `[next]/internal/font/google`, save the css2 response for Turbopack's UA
    (`Chrome/104.0.0.0`) before retrying.
  - `NEXT_FONT_GOOGLE_MOCKED_RESPONSES=<file exporting {cssUrl: css}>` replays a captured response offline.
