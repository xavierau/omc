# next build failed on Noto Sans HK via next/font/google (BUILD-FONT-001, PR #231)

Date: 2026-11-26. Blocked the BOOK-012 + TPL-012 release (`deploys/2026-11-26-book-012-release-runbook`).
Fixed by PR #231 (squash `4e870cb3` on develop, main `ffcf73ac`). Full record:
`.claude-workspace/artifacts/2026-11-26-build-font-001-handoff.md` and its evidence folder.

- **Problem:** `scripts/release.sh` ran `next build` (Turbopack, Next 16.3.4) twice, at 04:36Z and 04:42Z, and it
  failed both times with 327 errors, one for each Noto Sans HK `next/font/google` slice:
  `Module not found: Can't resolve '@vercel/turbopack-next/internal/font/google/font'` and
  `next/font/google queries have exactly one entry`. There was no font, Next, lockfile or config change in the release.
- **Root cause:** `next/font/google` fetches Google's css2 stylesheet at build time. Turbopack rewrites every font URL
  to `@vercel/turbopack-next/internal/font/google/font?<query>`, where `<query>` is
  `QString::from(serde_json::to_string({url, preload, has_size_adjust}))` (next 16.3.4,
  `crates/next-core/src/next_font/google/mod.rs` l.488). On resolve it parses the query again with `QString::from`
  and bails unless there is exactly one entry (l.638–642). `QString` splits on `&`, so the build fails exactly when a
  font URL contains `&`. Google does serve that form (`https://fonts.gstatic.com/l/font?kit=…&skey=…&v=v36`).
  - Reproduced 1:1: `0c41a4df` with `NEXT_FONT_GOOGLE_MOCKED_RESPONSES` set to today's real responses → exit 0; with
    each Noto URL rewritten to the `&` form → exit 1 with the same 327 / 327 / 654 error counts as the release log.
  - Trigger (external, transient, inferred): the same trees built cleanly from 04:47Z on. The body Google sent at
    04:36–04:42Z was not captured.
- **Fix:** `src/app/layout.tsx` no longer loads Noto Sans HK through `next/font/google`. It imports
  `src/app/fonts/noto-sans-hk.css`, which declares `--font-cjk` with next/font's exact value, the generated
  `Noto Sans HK Fallback` face and Google's css2 rules verbatim (gstatic URLs, no binaries). Nothing in that path is
  fetched at build time. The rendered result is unchanged (no element uses `--font-cjk` today; zh text renders in the
  system PingFang before and after; login screenshots byte-identical). Inter stays on `next/font/google`.
- **Prevention:**
  - Any `next/font/google` family can fail this way, Inter included (backlog item BUILD-FONT-002).
  - When a build fails inside `[next]/internal/font/google`, save the css2 response for Turbopack's UA
    (`Chrome/104.0.0.0`) before retrying.
  - `NEXT_FONT_GOOGLE_MOCKED_RESPONSES=<file exporting {cssUrl: css}>` replays a captured response offline.
