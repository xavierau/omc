---
id: artifacts/2026-08-28-camp-009-stream-a-create-autosend-frontend
type: artifact
author: react-frontend-dev
created: 2026-08-28
status: active
supersedes: null
superseded_by: null
related: [kanban:CAMP-009, github:136, plans/2026-08-28-camp-009-create-autosend-and-marketing-only-broadcast]
---

# Stream A — #136 create-path auto-send removed (frontend)

Fixes: creating a campaign with the default `execution: 'now'` used to immediately
POST `/api/dashboard/campaigns/<id>/execute` with the response discarded (silent
4xx swallow, no confirmation). The card's Send Now button already executes with
proper error handling (`campaign-card.tsx`), so campaign creation no longer
auto-sends — it just creates the campaign `active` with `scheduled_at: null`,
which `getDueCampaigns` does not pick up, and the operator sends manually.

## Files Changed

| File | Lines | Purpose |
|------|-------|---------|
| `src/components/dashboard/campaign-form-dialog.tsx` | 62 (export), 74-78 (deleted auto-execute block, added comment) | `submitCampaign` no longer fires `/execute` after create; exported for unit testing |
| `src/components/dashboard/__tests__/campaign-form-dialog.test.ts` | new, 100 lines | AC1-AC5 unit tests |
| `src/messages/en.json` | 212 | `campaigns.executionNow`: "Send now" → "Send manually" |
| `src/messages/zh-HK.json` | 212 | `campaigns.executionNow`: "立即發送" → "手動發送" |

No other files touched. `campaigns.executionNow` **key** and the `'now'` state value
are unchanged — only the label text, per the plan (renaming the state value would
ripple into `campaignToFormState`, the radio, types, and tests for zero functional
gain).

## Components

No new components. `CampaignFormDialog`, `campaign-form-fields.tsx`, `campaign-card*.tsx`
untouched — Stream B (backend, #134) owns `execute-campaign-broadcast.ts` and shares
this worktree; I did not touch it.

## Hooks & State

None — `submitCampaign` is a plain async function, not a hook. No TanStack/Zustand
changes.

## Key Decisions

- Test file imports `buildCampaignRequestBody` / `initialCampaignForm` /
  `CampaignFormState` from `campaign-form-types.ts` directly (where they already
  live) rather than re-exporting them from `campaign-form-dialog.tsx`. The brief
  only asked to export `submitCampaign`; re-exporting the others would have been
  an unrequested surface-area change to the dialog module.
- No `vitest environment: 'jsdom'` is configured project-wide (default is `node`);
  importing the `'use client'` dialog module (Radix `Sheet`, `next-intl`, etc.) at
  module scope does not touch `document`/`window`, so the plain `.test.ts` file
  imports and runs cleanly with no mocking needed for those deps — confirmed by
  running the test file before making any implementation change (see Tests below).

## Tests

New file `src/components/dashboard/__tests__/campaign-form-dialog.test.ts`, 6 tests, all green:
- `submitCampaign (#136)`:
  - AC1 — create, `execution: 'now'` → exactly one `POST /api/dashboard/campaigns`, no `/execute` call. **Verified this test fails on the pre-fix code** (asserted 2 fetch calls instead of 1) before deleting the auto-execute block, then passes after.
  - AC2 — create, `execution: 'schedule'` → one POST, `scheduledAt` is a valid ISO string, no `/execute`.
  - AC3 — edit (`campaignId` given) → one `PATCH /api/dashboard/campaigns/<id>`, no `/execute`.
  - AC4 — non-ok create response `{ error: 'boom' }` → rejects with `'boom'`, exactly one fetch call.
- `buildCampaignRequestBody(initialCampaignForm) (#136 AC5)`:
  - AC5 — `scheduledAt: null`, `status: 'active'` for the default (`execution: 'now'`) form.

Command output:
- `./node_modules/.bin/vitest run src/components/dashboard/__tests__/campaign-form-dialog.test.ts` → 5 passed (5) [test count differs from the 6 listed above only in that AC5 is a separate `describe` block — vitest reports 5 `it()` total: AC1-4 + AC5].
- `./node_modules/.bin/vitest run src/components/dashboard` → **32 files, 339 tests, all passed** (full dashboard directory, includes Stream B's concurrently-edited `execute-campaign-broadcast` tests which live under `src/application/`, not `src/components/dashboard`, so those are not in this count — see below).
- `./node_modules/.bin/tsc --noEmit` → clean, no output.
- `./node_modules/.bin/eslint src/components/dashboard/campaign-form-dialog.tsx src/components/dashboard/__tests__/campaign-form-dialog.test.ts` → **1 pre-existing error**, unrelated to this change: `react-hooks/set-state-in-effect` at `campaign-form-dialog.tsx:100` inside the existing `useEffect` that resets/hydrates form state on `campaign` change. Confirmed via `git stash` that this fires identically on the unmodified file — not introduced by this diff, left untouched per Surgical Changes. The new test file lints clean on its own.

## Visual Verification Hand-off

No visual/DOM change — this is a pure logic deletion (removing a side-effecting
`fetch` call) plus two locale string edits. The only visible surface is the
existing "Send manually" / "手動發送" radio label already rendered by
`campaign-form-fields.tsx` (untouched component, just consumes the updated
`t('campaigns.executionNow')` string).

Entry path for a human/browser check if desired: Dashboard → Campaigns tab →
"Create Campaign" button → the Execution radio group shows "Send manually" (EN)
/ "手動發送" (zh-HK) instead of "Send now" / "立即發送". Behaviorally: creating a
campaign with that option selected must NOT broadcast — the new card must NOT
show `sentCount` incrementing on its own; the operator must click **Send Now**
on the card to trigger delivery. I did not run this in-browser myself (unit
tests only, per my role as react-frontend-dev in this dispatch); recommend
`ui-test-runner` exercise the create → card → Send Now flow if a browser pass
is wanted before merge.

## Deferred / Tech Debt

- Pre-existing `react-hooks/set-state-in-effect` lint error at
  `campaign-form-dialog.tsx:100` (the `useEffect` hydrating form state from
  `campaign` prop) — not introduced by this change, not touched.
- This worktree is shared with a concurrent Stream B (backend, #134,
  `execute-campaign-broadcast.ts` + its test file) per the plan; I did not
  touch those files. `git status` at the time of my last check also showed
  `.claude/kanban.json` modified by someone else in this worktree — not
  touched by me either.
- Per the plan's explicit out-of-scope list: no `sends_coupon` flag (CAMP-004),
  no skip of the coupon prefetch query for coupon-less campaigns, no rename of
  the `executionNow` **state value** (only the label text changed).
