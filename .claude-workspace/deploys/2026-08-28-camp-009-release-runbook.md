---
id: deploys/2026-08-28-camp-009-release-runbook
type: deploy
author: claude
created: 2026-08-28
status: active
supersedes: null
superseded_by: null
related: [kanban:CAMP-009, kanban:CAMP-010, kanban:CAMP-011, github:136, github:134, github:140, github:141]
---

# CAMP-009 release runbook — #136 + #134 to production

## What ships
- PR #140 (`fix/camp-009-issues-136-134`, squash `0951582`) → develop: create-path auto-execute removed
  (#136); marketing-only broadcast mode + `enforceCouponParams` preflight (#134 + `/code-review`
  round 2). No migration.
- develop ⇐ origin/main merge `623895c` (CAMP-008 kanban/runbook chores), then PR #141 develop → main,
  merge commit **`d4d7839`**.
- `scripts/release.sh` builds locally and force-pushes the orphan `release` branch; Forge deploys it
  (`npm ci` → `supabase db push --linked --include-all` (no-op this time) → seed → restart).

## Pre-release facts (verified 2026-08-28)
- Prod ran `main@51dc2e7` (RELEASE.json on the box, BUILD_ID `aRUnY5dhv4IcHtA4wZKtK`).
- Build host: local macOS, Node v22.21.1 (release.sh gate ≥22).
- **Built from the CAMP-009 worktree, not the primary checkout.** The primary checkout carried a peer
  session's uncommitted TAG-001 edit to `.claude-workspace/INDEX.md`, which both blocked the
  fast-forward of `main` and would have tripped release.sh's clean-tree preflight. release.sh needs a
  local branch whose tip equals the same-named remote branch, and `release/<x>` is impossible while the
  orphan `release` branch exists (ref namespace clash), so a short-lived `release-camp-009` branch was
  pushed at exactly `d4d7839` and used as `SOURCE_REF`. `RELEASE.json.source_commit` is therefore the
  true main tip; `source_ref` reads `release-camp-009`. The branch is deleted after the deploy.
- Build-time env: `.env.local` + `.env.production.local` copied from the primary checkout into the
  worktree (the latter carries the prod `NEXT_PUBLIC_*` values); release.sh scrubs every `.env*` from
  the bundle.
- Prod data check (read-only, before merge): six campaigns with `coupon_config IS NULL` — five Kushiro
  `5th_anniversary` announcements (no `{{code}}`/`{{discount}}`, static buttons → marketing-only,
  unaffected by the preflight) and `4ce3b1e4` "Free Drink Promotion" (`completed`, template
  `free_drink` with a `{{1}}` URL button → would now be refused with the 409 if re-executed; it cannot
  be, status is not active).

## Blast radius to announce (ops)
1. **Creating a campaign no longer sends it.** The form's default radio is now *Send manually*; the
   operator clicks **Send Now** on the card (or schedules). A campaign at `active / 0 sent` is waiting
   for that click, not broken.
2. **Campaigns with no coupon configured send only the template** — no coupon row, no QR image. The
   `131047` QR failures for Kushiro's announcements stop.
3. **New 409 on execute** — "add a discount to the campaign or pick a template without a coupon code"
   — for a coupon-less campaign whose template uses `{{code}}`/`{{discount}}`, a dynamic URL button,
   a COPY_CODE button, or a claim (QUICK_REPLY) button, or whose inline copy references
   `{{code}}`/`{{couponCode}}`/`{{discount}}`. Scheduled runs hitting it fail with that reason on the
   card. Workaround for a "free item" coupon until CAMP-004: configure a 100 % discount.

## Post-deploy verification
1. `curl -sf https://app.ohmyclient.io/api/health` → 200; `RELEASE.json` on the box shows
   `source_commit d4d7839…`.
2. Bundle check on the box: the deployed campaigns-page chunk contains the new label
   ("Send manually" / "手動發送") and `enforceCouponParams` is present in the server bundle.
3. Next campaign create by any tenant: `campaigns` row written, **no** `campaign-execution` job within
   seconds of it (the #136 signature was a ~3 s create→enqueue gap).

## Rollback
Re-run `scripts/release.sh` from the previous main commit (`SOURCE_REF` at `51dc2e7`, same
same-named-branch trick if the primary checkout is still dirty). No migration to reverse.

## Release facts
`release` branch `6443db0` = `main@d4d7839` (RELEASE.json `source_ref: release-camp-009`, `source_commit`
`d4d7839…`), `BUILD_ID K_BSezxKjjMOgGpOtU8Pp`, built 05:21:07Z; Forge deployed within 17 s of the push
(app daemon 746791 + worker 801730 RUNNING, `/api/health` 200). Temp branch `release-camp-009` deleted
after the deploy.

**Bundle verification on the box (05:2xZ):** `src/messages/en.json` / `zh-HK.json` carry
`executionNow: "Send manually"` / `"手動發送"` (next-intl reads them at runtime — the strings are not
literal in `.next`); `enforceCouponParams` present in `src/application/execute-campaign.ts` and in 3
server-bundle files; the deployed campaigns client chunk (`0q3jv_gkfks5t.js`) contains exactly **one**
`/execute` — the card's — where the pre-fix chunk had the dialog's second call.

Issues #136 and #134 closed with release comments. First organic proof of #136 comes with the next
campaign any tenant creates: no `campaign-execution` job within seconds of the row insert.
