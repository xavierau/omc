---
id: artifacts/2026-08-27-camp-008-stream-d-quick-reply-frontend
type: artifact
author: react-frontend-dev
created: 2026-08-27
status: active
supersedes: null
superseded_by: null
related: [kanban:CAMP-004, github:132, plans/2026-08-27-camp-008-outbound-status-and-claim-button]
---

# Stream D — #132 QUICK_REPLY authoring (frontend)

Fixes the dashboard-side half of #132: the WhatsApp template form could not author a
`QUICK_REPLY` button, so claim-mode campaigns (`isClaimTemplate` in
`src/application/execute-campaign-broadcast.ts`) were unreachable. Also fixes the
unvalidated round-trip cast in `parseButtons` that silently rewrote unknown stored
button types (e.g. `COPY_CODE`) on save.

## Files Changed

| File | Lines | Purpose |
|------|-------|---------|
| `src/components/dashboard/wa-template-form-types.ts` | ~+35/-6 | `TemplateButton['type']` gains `QUICK_REPLY` and `UNSUPPORTED`; new `raw?: Record<string, unknown>` field on UNSUPPORTED buttons; `parseButtons` no longer casts unknown stored types, maps to `UNSUPPORTED` carrying the original object; `buildWaTemplateRequestBody` re-emits an UNSUPPORTED button's `raw` unchanged; `validateWaTemplateButtons` skips UNSUPPORTED rows |
| `src/components/dashboard/wa-template-buttons-section.tsx` | +30 | Added `<option value="QUICK_REPLY">Quick reply</option>`; QUICK_REPLY row shows a one-line hint, no url/phone input; UNSUPPORTED rows render read-only (no `<select>`, a "can't be edited here" notice, Remove still available) |
| `src/components/dashboard/__tests__/wa-template-form-types.test.ts` | +89 | New tests: QUICK_REPLY clears url/phone on type switch, validation (label-only), wire emission (no url/phoneNumber keys); new `templateToFormState button round-trip` describe block covering QUICK_REPLY round-trip, COPY_CODE → UNSUPPORTED with `raw`, unknown type → UNSUPPORTED, byte-for-byte re-emission |
| `src/components/dashboard/__tests__/wa-template-buttons-section.test.tsx` | new, 100 lines | Component test (house shallow-render style, matching `wa-template-form-fields.test.tsx` / `wa-template-table.test.tsx` — no `@testing-library/react` used anywhere in this project): select offers "Quick reply", QUICK_REPLY row has no url/phone input and shows the claim-mode hint, UNSUPPORTED row has no select, shows the read-only notice, still has Remove |

## Components

- No new component files. Extended the existing `WaTemplateButtonsSection` / `ButtonRow` (`src/components/dashboard/wa-template-buttons-section.tsx`) in place — this form is a single-purpose dashboard feature component, not a reusable `/ui` or `/patterns` primitive, so extension in place is the correct location per the component-discovery table.

## Hooks & State

None — this slice is pure domain/presentation (form-state transform functions + a stateless presentational component). No TanStack/Zustand involved.

## Key Decisions

- Followed plan D6 exactly: label-only QUICK_REPLY option, no new url/phone field. `applyTemplateButtonChange` needed **no code change** — its existing ternary (`url: type === 'URL' ? ... : ''`, `phoneNumber: type === 'PHONE_NUMBER' ? ... : ''`) already clears both fields for any other type, QUICK_REPLY included. Verified with a new test rather than assumed.
- `UNSUPPORTED` is a same-shape variant on `TemplateButton` (adds one optional `raw` field) rather than a discriminated union, so `createTemplateButton`, `applyTemplateButtonChange`, and the `ButtonRow` prop contract stay unchanged for the other four types — smaller diff than restructuring `TemplateButton` into a union.
- `parseButtons` rewritten as explicit type checks (`URL` / `PHONE_NUMBER` / `QUICK_REPLY` / coupon-URL detection / else-UNSUPPORTED) rather than the old blind cast. Kept the existing coupon-URL detection heuristic (`url.includes('/coupon/')`) unchanged — out of scope for #132.
- UI never offers a `<select>` on an UNSUPPORTED row, so `applyTemplateButtonChange` can never be invoked with `key: 'type'` on one — confirmed no defensive `raw`-stripping code was needed to satisfy the acceptance criteria, kept the diff surgical rather than adding speculative handling.
- Domain/validation/send/claim paths untouched, per the plan's stated boundary — `TemplateButtonType` already had `QUICK_REPLY`, `validateButtons` (domain) was already type-gated, `prepareTemplateComponents` already passes buttons through unchanged.

## Tests

- Domain/form-state (`wa-template-form-types.test.ts`): 8 new tests (2 `applyTemplateButtonChange`, 3 `validateWaTemplateButtons`, 2 `buildWaTemplateRequestBody`, 1 new `templateToFormState` describe block with 4 sub-tests — counted as the 8th grouping). File total now covers QUICK_REPLY end-to-end plus UNSUPPORTED round-trip.
- Component (`wa-template-buttons-section.test.tsx`, new file): 6 tests across 2 describe blocks (quick reply option/hint/no-inputs; UNSUPPORTED no-select/notice/remove).
- All existing tests in `src/components/dashboard` continue to pass unmodified (no behavior change for URL/PHONE_NUMBER/COUPON_URL buttons).

### Commands run

```
./node_modules/.bin/vitest run src/components/dashboard
  → Test Files  31 passed (31)  |  Tests  329 passed (329)

./node_modules/.bin/tsc --noEmit
  → clean, no output

./node_modules/.bin/eslint src/components/dashboard/wa-template-form-types.ts \
  src/components/dashboard/wa-template-buttons-section.tsx \
  src/components/dashboard/__tests__/wa-template-form-types.test.ts \
  src/components/dashboard/__tests__/wa-template-buttons-section.test.tsx
  → clean, no output
```

## Visual Verification Hand-off

Not dispatched to `ui-test-runner` from this agent — per the dispatch brief this was a
scoped Stream D fix within a larger multi-stream plan; browser verification is expected
to be coordinated by the orchestrator once all streams land (Streams A/B/C touch the
send/webhook path this feature depends on end-to-end). If a standalone visual pass is
wanted now:

- **Entry path**: Dashboard → WhatsApp Templates page → "New template" (or edit an
  existing draft/rejected template) → Buttons section → "+ Add button".
- **Flow 1**: Select "Quick reply" in the type dropdown → confirm only the label input
  shows (no URL/phone field) → confirm the hint text "Customers tap to reply — used by
  claim-mode campaigns" renders → fill a label → Save → template persists with a
  `QUICK_REPLY` button.
- **Flow 2**: Edit a template that has a `QUICK_REPLY` button already stored (e.g. one
  saved via Flow 1) → confirm it re-opens with type "Quick reply" selected, label
  populated.
- **Flow 3 (harder to stage without a COPY_CODE-carrying template)**: if a template with
  a `COPY_CODE` or otherwise unrecognized button type exists in the DB, opening it for
  edit should show that row read-only (no dropdown, "This button type can't be edited
  here" notice, Remove still clickable) and Save should not alter that button on the
  wire.
- Expected: no console errors; existing URL/Phone/Coupon button flows unaffected
  (regression-check those three too, since `ButtonRow` was touched).

## Deferred / Tech Debt

- CAMP-004 (explicit claim-campaign flag instead of inferring from button shape) is
  intentionally out of scope, per the plan — `isClaimTemplate` still infers from the
  presence of a `QUICK_REPLY` button.
- No i18n keys added — this form is currently hard-coded English throughout
  (`wa-template-buttons-section.tsx` has no `next-intl` usage), matched existing style
  rather than introducing partial i18n.
- Browser/visual verification of this specific change not run by this agent (see above)
  — self-checks (vitest/tsc/eslint) are green; recommend a `ui-test-runner` pass once
  the full CAMP-008 plan (Streams A–D) lands together, since the claim-mode send path
  this unblocks depends on Streams A–C.
