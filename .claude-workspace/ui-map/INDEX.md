# UI Map Index

_Scaffolded 2026-08-24 by ui-test-runner — first run for this project, no prior Map existed._

Read order: `INDEX.md` → `env-policy.md` → `environments.md` → `login-recipes.md` →
`testid-registry.md` → `layout-baseline.md` → relevant `flows/*.md`.

## Status

All files below are **empty scaffolds**. None have been filled with real project data yet —
no environment URLs beyond what a caller has stated inline, no login recipe, no selectors,
no confirmed flows. Every field marked `TODO` needs a human or a caller with authority over
credentials to fill in before any write-flow can run.

## Files

- [env-policy.md](env-policy.md) — allowed actions per environment (prod allowlist, etc.)
- [environments.md](environments.md) — base URLs, test org ids, breakpoints per env
- [login-recipes.md](login-recipes.md) — how to authenticate per env/role
- [testid-registry.md](testid-registry.md) — confirmed `data-testid` selectors, built up only from passing interactions
- [layout-baseline.md](layout-baseline.md) — accepted layout exceptions (human-curated only)
- [secrets.local.example.json](secrets.local.example.json) — shape for the gitignored `secrets.local.json`
- [flows/](flows/) — one file per named scenario

## Tests

(none run yet — first verification pending env/credential input, see latest run notes in
`.claude-workspace/tests/`)
