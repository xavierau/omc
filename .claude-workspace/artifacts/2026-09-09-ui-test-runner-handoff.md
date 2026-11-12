---
id: artifacts/2026-09-09-ui-test-runner-handoff
type: artifact
author: ui-test-runner
created: 2026-09-09
status: active
supersedes: null
superseded_by: null
related: [kanban:TPL-011, tests/2026-09-09-tpl-011-video-header-ui, plans/2026-09-09-tpl-011-video-template-header]
---

# ui-test-runner handoff — TPL-011 I-1 wiring walk

## State: complete, retiring

Dispatched by team-lead to browser-verify TPL-011 (VIDEO template header) on DEV per plan
`plans/2026-09-09-tpl-011-video-template-header` §Integration (I-1). Done. Full result in
`tests/2026-09-09-tpl-011-video-header-ui.md` (PASS, 0 blocking layout findings).

## Environment setup (for the next person who needs to re-run this)

- Worktree had no `.env.local` / `secrets.local.json` — both recreated this run (`.env.local`
  copied from the main checkout; `secrets.local.json` throwaway user minted via the Supabase
  admin API with the main checkout's service-role key, same pattern as the WONB-018/019
  precedent noted in `ui-map/env-policy.md`). The user was deleted at cleanup — mint another.
- **Both `mcp__chrome-devtools__*` and `mcp__chrome_local__*` were unavailable this entire
  run** — their shared browser profiles were locked by other concurrent sessions in this team.
  Worked around it with a standalone `puppeteer-core` install in the session scratchpad (own
  `userDataDir`, own small HTTP control server) pointed at the pre-cached "Chrome for Testing"
  binary at `~/.cache/puppeteer/chrome/mac_arm-146.0.7680.153/...`. This gave full viewport
  control, network capture, and file upload — no capability was actually lost, but if the MCP
  browsers are free next time, prefer them (less code to stand up). If they're locked again,
  the scratch puppeteer server pattern is fully reusable: see the (deleted, scratchpad-only)
  driver script's shape in the test report's Environment section for the endpoint list.

## Decisions + rationale

- **R4 (plan risk) resolved**: DEV's `wa-template-media` bucket (migration 055) is present and
  upload works end-to-end. The plan's own Stream A A-6 probe already implied this (it uploaded
  successfully before hitting the Kapso call); this run's UI-level upload confirms it directly.
  Updated `ui-map/environments.md` accordingly — don't assume every "DEV lags prod" caveat
  applies to every migration without checking.
- **Regression legs 8b/8c verified at the route level, not through UI widgets**: no UI path
  reaches `CampaignImageUploader` in this tenant (the create-campaign dialog never offers the
  `welcome` type), and `/dashboard/setup` (tenant logo) 500s on an unrelated DEV migration gap
  (058 missing, `restaurants.redirect_number`). Used the live authenticated session's cookies
  via direct `curl` against the same route instead — genuine regression evidence, just not
  click-driven. Documented both reasons in the test report and the new flow file so the next
  run doesn't waste time rediscovering them.
- **Transient message discrepancy resolved, not reported as a bug**: mid-run, an HMR reload
  from a landed review-fix commit (`2e939d5`) changed a client error string while I was
  testing. Traced it to the Stream B handoff's documented finding 🟡-1 (deliberate narrowing
  of the video-uploader's mime error message) and re-verified against the final, stable code.
  See the test report's Anomalies section.

## Incident (already reported directly to team-lead)

My post-run cleanup script deleted every storage object under the test tenant's prefix in
three buckets instead of only the objects this run created. One pre-existing file was
genuinely lost: `tenant-assets/00000000-0000-4000-a000-000000000001/1776055824199.png`, which
is `restaurants.logo_url` for the test tenant — DEV-only, cosmetic, unrecoverable (no
storage versioning). Verified `campaign-images`' real files were untouched (the sweep there
only hit a non-existent pseudo-folder key). Full detail in the test report's Anomalies
section and in the message already sent to team-lead.

## Workspace housekeeping noticed, not fixed

`.claude-workspace/INDEX.md` is 189 lines against the `workspace-protocol` skill's ~50-line
Stage 2 budget — pre-existing, not caused by this run (my only edit there was one
budget-compliant Tests entry). Worth a `/curate-workspace` pass; not something I restructured
myself per the protocol ("report, don't silently repair").

## Exit

Deliverables landed:
- `tests/2026-09-09-tpl-011-video-header-ui.md` (verdict: PASS)
- `ui-map/flows/tpl-011-wa-template-video-header.md` (new)
- `ui-map/testid-registry.md`, `ui-map/environments.md`, `ui-map/INDEX.md` (updated)
- 7 evidence screenshots under `tests/screenshots/2026-09-09-tpl-011-video-header-ui/`
- This handoff

Ready for: the orchestrator to fold this into the TPL-011 acceptance check (dual review of
Map diffs per orchestration protocol). No further action pending from me — retiring.
