---
id: deploys/2026-08-28-wonb-018-019-release-runbook
type: deploy
author: claude
created: 2026-08-28
status: active
supersedes: null
superseded_by: null
related: [kanban:WONB-018, kanban:WONB-019, github:148, github:147, github:149, github:152, github:150, github:151, plans/2026-08-28-wonb-018-019-csv-parser-and-template, deploys/2026-08-28-tag-001-release-runbook]
---

# WONB-018 / WONB-019 release runbook — #148 CSV parser + #147 import template to production

## What shipped
- PR **#149** `feature/wonb-018-issues-147-148` → develop (squash **a220d37**): RFC 4180 tokeniser
  (`csv-tokenizer.ts`), `parseCsv` → `{ phoneHeaderFound, rows, rejected }` with
  `column_count_mismatch` / `unterminated_quote` rejections shown on the upload step and never
  posted; downloadable `import-template.csv` (BOM + CRLF, quoted-name row) pinned to the parser by a
  round-trip test; always-visible CSV format help (en + zh-HK); review-round hardening (header quote
  named first, `rejectPhone` guard, newline handling in names/tags, NBSP/U+3000, direction-aware
  hint, file-input reset, unreadable-file error). Zero migrations, zero env changes, zero new deps.
- `origin/main` merged into develop (**b1d4cb0**) to resolve the develop→main conflict the squash
  created on `kanban.json` / `INDEX.md` (memory `incident_squash_after_main_merge_conflicts_develop_to_main`).
- PR **#152** develop → main (merge **5f2369a**).
- `scripts/release.sh` from the worktree branch `release-wonb-018` (= main tip, memory
  `project_release_from_worktree`): BUILD_ID `eg46F8RozAOtTEZ_2yaLt`, built 10:44Z, secret scan clean,
  `release` branch **3680ffe** (force-pushed orphan; previous 1493ad7). `RELEASE.json.source_ref`
  reads `release-wonb-018`; `source_commit` = 5f2369a is the real main tip.

## Deploy facts (Forge, 2026-08-28)
- Previous prod: `main@8b18af7` (TAG-001, built 07:07Z).
- `RELEASE.json` on the box flipped to 5f2369a by **10:45:34Z** (≈ 30 s after the push); app daemon
  746791 (`next-server`, listens on **:3100**) and worker 801730 restarted ≈ 10:45:25Z — both RUNNING
  with matching uptimes at 10:52Z.
- Public `https://app.ohmyclient.io/api/health` → **200** (0.27–0.35 s) at 10:52Z. (A
  `127.0.0.1:3000` probe on the box returns 000 even when healthy — wrong port; use the public URL.)
- Scheduled jobs kept firing across the restart: sync-templates 10:45:01Z (3 restaurants),
  reconcile-orphan-messages 10:50:01Z (`swept: 0`).
- Migrations applied: **none** (nothing to apply).

## Post-deploy verification (read-only, on the box)
```
.next/BUILD_ID                          eg46F8RozAOtTEZ_2yaLt   (matches the local build)
grep -rl column_count_mismatch .next/static   1 file  (rejections panel + reason keys in the client chunk)
grep -rl import-template.csv   .next/static   1 file  (template download in the client chunk)
```
The English help strings are not in `.next/server` because messages load from JSON at runtime — expected.

## Blast radius to announce
1. **Import wizard upload step, every tenant**: a "CSV format" help block with a "Download CSV
   template" action; files whose rows can't be read now show a rejections panel (line · phone · reason)
   and Next stays disabled until the file is fixed. Quoted names (`"Chan, Tai Man"`) now import
   correctly; unquoted commas are rejected instead of silently shifting columns and minting a junk
   tag.
2. **Stricter than before**: rows with **fewer** cells than the header (hand-maintained phone+name
   files under a 4-column header) are now rejected with a "add the missing commas" hint — pad the rows
   or use a 2-column header. Rows whose `preferred_language` is not `en`/`zh_hk` still import with a
   blank language (#150 asks whether that should reject too).
3. No API, wire, DB or worker changes.

## Not verified — say so
- No prod import was run (no prod test tenant; env policy forbids writes on real tenants). Browser
  evidence is from **dev** (`tests/2026-08-28-wonb-018-019-ui-verification`, throwaway tenant admin,
  zh-HK) and predates the `/code-review` round's UI fixes (input reset, unreadable error,
  direction hint, plural) — those are unit-pinned only.
- `en` locale not browser-run (one locale per deployment; prod renders zh-HK); covered by the
  locale-parity + key-list tests.
- Big5-encoded CSVs still decode as mojibake (#151, pre-existing).

## Rollback
Re-run `scripts/release.sh` from a branch at `8b18af7` (`SOURCE_REF` = that branch). No migrations to
consider. The only user-visible reversal is the upload step losing the help/template/rejections UI.

## Cleanup performed
Worktree `../whatsapp-crm-wonb-018-worktree` removed; remote branches
`feature/wonb-018-issues-147-148` (merged) and `release-wonb-018` (temp) deleted; throwaway dev
Supabase user `ui-test-wonb018@example.com` + its `user_tenants` row deleted; `ui-map/secrets.local.json`
removed from both checkouts; the primary's stale untracked `ui-map/` scaffold replaced by the tracked
one (backup in the session scratchpad).
