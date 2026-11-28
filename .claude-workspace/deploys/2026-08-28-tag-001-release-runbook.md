---
id: deploys/2026-08-28-tag-001-release-runbook
type: deploy
author: claude
created: 2026-08-28
status: active
supersedes: null
superseded_by: null
related: [kanban:TAG-001, kanban:WONB-017, github:138, github:139, github:142, github:143, github:144, github:145, github:146, plans/2026-08-28-tag-001-issues-138-139]
---

# TAG-001 / WONB-017 release runbook — #138 member tags + #139 import preview to production

## What shipped
- PR **#142** `feature/tag-001-issues-138-139` → develop (squash **c6703d8**): PR #51's tagging work
  (July, never merged) merged with develop, migrations renumbered 054/055 → **065/066**, plus the
  #138 deltas (CSV `tags` column, multi-tag OR targeting + live recipient count, bulk tag/untag)
  and all of #139 (preview rejections panel, read-only member/consent lookups with merge-aware
  client-side counts, post-commit rejection list). New RPCs **067** `count_active_members_by_tags`
  and **068** `upsert_tags_by_name`, both with the 064 REVOKE/GRANT lockdown.
- PR **#143** develop → main (merge **8b18af7**).
- `scripts/release.sh` from the worktree branch `release-tag-001` (= main tip, per memory
  `project_release_from_worktree`): BUILD_ID `K_7ffL8ySfalRUFdxHQSX`, built 07:07:30Z, secret scan
  clean, `release` branch **1493ad7** (force-pushed orphan). `RELEASE.json.source_ref` therefore
  reads `release-tag-001`; `source_commit` = 8b18af7 is the real main tip.

## Deploy facts (Forge, 2026-08-28)
- Previous prod: `main@d4d7839` (CAMP-009, built 05:21Z by the peer session).
- Forge picked the push up within 45 s; app daemon 746791 + worker 801730 restarted at ~07:08:20Z;
  `/api/health` 502 during the restart window, **200 at 07:08:31Z**.
- Migrations applied by the deploy's `supabase db push --linked --include-all`: **065–068**.

## Post-deploy verification (read-only probe run ON the box with its own `.env`, script
`scratchpad/prod-probe-tags.sh`)
```
RELEASE.json: 8b18af7 2026-08-28T07:07:30Z
health: 200
table tags           service_role → 200   anon → [{"count":0}]   (RLS: anon sees nothing)
table member_tags    service_role → 200   anon → [{"count":0}]
table campaign_tags  service_role → 200   anon → [{"count":0}]
rpc count_active_members_by_tags (zero uuid, []) service_role → 0 [200]; anon → 401
rpc upsert_tags_by_name (zero restaurant) service_role → 23503 FK violation (exists, wrote nothing); anon → 401
campaigns?target_audience=eq.tag → 200
```
Worker log: `Workers started: campaign, event-dispatch, receipt, email-send`. App log shows the
known `output: standalone` boot warning (#120) and a burst of `Failed to find Server Action` from
clients that loaded the previous deployment — expected across a restart.

## Blast radius to announce
1. **Import wizard changes for every tenant**: preview now lists rejected rows and warns about
   already-member / already-consented phones (counts react to the merge checkbox); the confirm step
   lists rejections with copy/CSV. A CSV `tags` column (`;`-separated) now mints tags —
   **max 50 new tags per import** (400 before anything is written), max 10 tags per row, 40 chars.
2. **Campaign targeting gains `tag`** (multi-select, OR). Recipient count is advisory; the send
   path resolves the audience at send time, active members only. Deleting a tag still cascades out
   of `campaign_tags` (#144).
3. **API contract**: campaign routes answer **403** (was 400) for a foreign tag id; PATCH validates
   `tagIds` and clears `campaign_tags` when the audience moves away from `tag`.
4. New endpoints: `POST /api/dashboard/members/bulk-tags`, `GET /api/dashboard/tags/recipient-count`.

## Not verified — say so
**No in-browser walk was possible** (dev Supabase is ~30 migrations behind and password-less;
local `supabase start` segfaults — memory `incident_no_browser_env_for_db_features`, issue #146).
Coverage is code-level: 422 files / 4,267 vitest tests, component tests for every feedback state,
scratch-Postgres replays of 065–068, gemini + analyzer review lanes, qa-engineer verdict, and the
recovered `/code-review` finders (round 2). First real proof of the UI comes from the first tenant
import/campaign on prod — watch `logs/` for `too_many_new_tags`, `claim.not_targeted` and
`tagging` failures.

## Rollback
Re-run `scripts/release.sh` from `d4d7839` (`SOURCE_REF` = a branch at that commit). Migrations
065–068 are additive (3 tables + 2 functions + a widened CHECK); safe to leave in place — a rolled
back app simply never writes to them.
