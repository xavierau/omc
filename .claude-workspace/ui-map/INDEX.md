# UI Map Index

_Scaffolded 2026-08-24. First populated 2026-08-28 (WONB-018/019 run). Updated 2026-09-09 (TPL-011 run). Updated 2026-09-10 (INT-001/WI-12 run, partial — blocked by a DEV PostgREST schema-cache gap)._

Read order: `INDEX.md` → `env-policy.md` → `environments.md` → `login-recipes.md` →
`testid-registry.md` → `layout-baseline.md` → relevant `flows/*.md`.

## Status

Populated from real runs. `secrets.local.json` itself is gitignored and per-worktree — it does
**not** survive a worktree being removed, so a fresh worktree needs a throwaway user re-minted
(pattern: `env-policy.md` § dev; both the 2026-08-28 and 2026-09-09 runs did this). `layout-baseline.md`
is still empty — no exceptions have been human-accepted yet, though both runs have proposed candidates
in their `tests/` reports.

## Files

- [env-policy.md](env-policy.md) — allowed actions per environment (prod allowlist, etc.)
- [environments.md](environments.md) — base URLs, test org ids, breakpoints, confirmed env facts (buckets/migrations present or missing on DEV)
- [login-recipes.md](login-recipes.md) — how to authenticate per env/role
- [testid-registry.md](testid-registry.md) — confirmed selectors, built up only from passing interactions (CSV import step, WA template form)
- [layout-baseline.md](layout-baseline.md) — accepted layout exceptions (human-curated only; empty so far)
- [secrets.local.example.json](secrets.local.example.json) — shape for the gitignored `secrets.local.json`
- [flows/](flows/) — one file per named scenario: `wonb-018-019-csv-import-upload-step.md`, `tpl-011-wa-template-video-header.md`, `issue-102-template-review-send-feedback.md`, `issue-103-campaign-member-picker.md`, `int-001-integrations-dashboard.md`

## Tests

- `tests/2026-08-28-wonb-018-019-ui-verification.md` — CSV import upload step, PASS
- `tests/2026-09-09-tpl-011-video-header-ui.md` — WA template VIDEO header, PASS (Kapso ingest still inconclusive on DEV, I-2 mandatory)
- `tests/2026-09-10-int-001-ui-walk.md` — Integrations dashboard, BLOCKED (DEV PostgREST schema-cache gap); list/create/inbound-rotate PASS
