---
id: reviews/2026-08-27-camp-004-quick-reply-analyzer
type: review
author: code-review-analyzer
created: 2026-08-28
status: active
supersedes: null
superseded_by: null
related: [plans/2026-08-27-camp-008-outbound-status-and-claim-button, artifacts/2026-08-27-camp-008-stream-d-quick-reply-frontend, kanban:CAMP-004, github:132]
---

# Code Review: #132 QUICK_REPLY authoring in the template form (PR #133, commit 9c41b04)

Second review lane (grok-cli-reviewer unavailable). Scope: `git diff origin/develop...HEAD` on
`fix/camp-004-quick-reply-button` — 4 source/test files + 1 handoff artifact. Verified locally:
`vitest run` on the two touched test files → 33/33 pass; `tsc --noEmit` → clean.

## Summary

The diff does exactly what plan D6 prescribes and nothing more: `QUICK_REPLY` joins the form
union and the `<select>`; `parseButtons` stops blind-casting stored types and maps anything it
has no editor for to a read-only `UNSUPPORTED` row that `buildWaTemplateRequestBody` re-emits
verbatim. Wire shape for QUICK_REPLY is correct (type + text only), COUPON_URL and the #97
phone-button path are untouched and still covered by the JSON-round-trip tests. The `raw`
pass-through opens no new trust-boundary hole — the browser was never a trust boundary here
(see Security below). No Critical findings. One Important finding is a repo-rule omission
(debugging journal), not a code defect; the rest are Minor.

## Security (lens 1)

**Question asked: can an UNSUPPORTED button's verbatim `raw` re-emit let a tenant smuggle
arbitrary keys to Meta or the API route?** Answer: nothing new.

- Provenance: `raw` is the tenant's own stored button, fetched through the tenant-scoped GET
  (`findTemplateByIdForRestaurant`) and echoed back to the same tenant's PATCH. No cross-tenant
  vector; the object never crosses a tenant boundary.
- Server side, pre-existing and unchanged by this PR:
  `src/app/api/dashboard/wa-templates/route.ts:64-70` (`validateCreateBody`) checks only
  `Array.isArray(body.components)`; `[id]/route.ts:46-51` (PATCH) validates nothing;
  `normalizeTemplateComponents` only rewrites full-width braces; `prepareButtons`
  (`src/domain/services/prepare-template-components.ts:61-69`) spreads `...b`, so any key a
  client puts on a button already reaches Meta via the Kapso SDK. A tenant with `curl` could
  do this before 9c41b04; the form re-emitting a stored object adds no capability.
- Inside our system the stored `components` JSONB is read only through typed accessors
  (`type`, `text`, `url`, `phoneNumber`) in the send/claim paths; unknown keys are inert.
- Meta validates its own schema; the worst outcome of a stray key is a `meta_rejected` 422,
  already handled.
- Rendering: `{btn.raw?.type} button: {btn.text}` is React-escaped text — no XSS.

Recommendation (out of scope for this hotfix, logged under Open Questions): a component/button
schema whitelist at the API route is the actual gap, and it predates this PR.

## 🔴 Critical (Must Fix)

None.

## 🟡 Important (Should Fix)

### I1 — No debugging journal for a `fix:` commit

- **Where**: repo root — `debugging_journals/` has no entry for #132; the diff touches none.
- **Problem**: `rules/documentation.md` marks a journal MANDATORY after bug fixes, and this repo
  follows it (14 entries; the immediately preceding fix, #128 / commit 091afdc, shipped
  `debugging_journals/2026-08-24-campaign-media-header-132012.md` in the same PR).
- **Risk**: the root-cause chain (mode inferred from button shape → form cannot author the
  shape → claim mode dead in prod → eager fallback hits the 24h window / 131047) and the
  prevention measure (CAMP-004 explicit flag) live only in the GitHub issue and the plan; the
  journal is the repo-local anti-recurrence record the debug workflow reads first.
- **Fix**: add `debugging_journals/2026-08-27-claim-mode-unreachable-quick-reply.md` with
  Problem / Root cause / Solution / Prevention (prevention = CAMP-004 explicit flag; interim =
  the `UNSUPPORTED` round-trip guard). Ten minutes; no code change.

## 🟢 Minor (Optional)

### M1 — `raw` is optional on every variant, so an UNSUPPORTED button without it is representable

- **Where**: `src/components/dashboard/wa-template-form-types.ts:10` (`raw?:`) and `:150`
  (`if (b.type === 'UNSUPPORTED') return b.raw`).
- **Problem**: the only producer (`parseButtons:119`) always sets `raw`, so this is
  theoretical today — but if any future caller builds `{ type: 'UNSUPPORTED' }` without it, the
  builder emits `undefined`, `JSON.stringify` turns that array slot into `null`, and the server's
  `validateButtons` (`validate-template-components.ts:44`) throws `TypeError` on `null.text`
  instead of returning a user-facing message. The dev's handoff explicitly chose same-shape +
  optional field to keep the diff surgical; that trade-off is reasonable for a hotfix.
- **Fix (when CAMP-004 lands)**: make the variant carry its invariant — a discriminated union
  `{ type: 'UNSUPPORTED'; text: string; url: string; phoneNumber: string; raw: Record<string, unknown> }`
  unioned with the editable shape — or, cheaper now, guard the builder:
  `if (b.type === 'UNSUPPORTED') return b.raw ?? { type: 'UNSUPPORTED', text: b.text }` so a
  malformed row at least fails with Meta's/our validator's readable message rather than a null
  dereference.

### M2 — UNSUPPORTED branch inlined into `ButtonRow`

- **Where**: `src/components/dashboard/wa-template-buttons-section.tsx:44-64`.
- **Problem**: `ButtonRow` was already over the 20-line target (existing file — Surgical
  Changes applies, not a violation); the early return adds a second copy of the row chrome and
  the Remove button (`:51-57` duplicates `:79-85`). Two copies is fine by the DRY rule; noted
  because a third (e.g. a future COPY_CODE editor) would be the extraction point.
- **Fix**: extract `UnsupportedButtonRow({ btn, index, onRemove })` in the same file and reduce
  the `ButtonRow` change to a one-line dispatch. Optional.

### M3 — Component test does not exercise the one interaction it introduces

- **Where**: `src/components/dashboard/__tests__/wa-template-buttons-section.test.tsx:97-102`
  ("still offers Remove").
- **Problem**: asserts the Remove element exists but never invokes it; the read-only row's only
  affordance is untested end-to-end (`onRemove(index)` → `onChange('buttons', [])`).
- **Fix**: `(removeBtn!.props as { onClick: () => void }).onClick()` then
  `expect(onChange).toHaveBeenCalledWith('buttons', [])` — same shallow-render convention, no
  new deps.

### M4 — Regression guard for the untouched rows lives only at the form-state layer

- **Where**: same test file; no case renders a `PHONE_NUMBER` or `URL` row.
- **Problem**: `ButtonRow` was restructured (early return inserted above the editable path).
  The #97 wire-shape tests in `wa-template-form-types.test.ts:165-178` still pass, so the
  phone number reaches the request body — but nothing asserts the phone `<input>` still renders
  for a `PHONE_NUMBER` row after the change. Low risk (the editable path's edit is purely
  additive: one `<option>`, one hint).
- **Fix**: one case — render `button({ type: 'PHONE_NUMBER' })`, assert an input with
  placeholder `+852 1234 5678` is present; same for URL with `https://...`. Also tightens the
  QUICK_REPLY case at `:57-63`, which currently proves "1 input" rather than "no url/phone
  input".

### M5 — Hint located by substring instead of `data-testid`

- **Where**: `wa-template-buttons-section.test.tsx:65-72` (`includes('claim-mode')`) and
  `:91-96` (`includes("can't be edited here")`).
- **Problem**: the sibling convention (`wa-template-form-fields.test.tsx:46-48`) locates hints by
  `data-testid`, so copy edits don't break tests.
- **Fix**: add `data-testid="quick-reply-hint"` / `"unsupported-button-notice"` on the two
  `<p>` elements and select on those.

### M6 — `wa-template-form-types.ts` crossed the 150-line target (146 → 164)

- Existing file; Surgical Changes outranks the limit, so not a finding against this PR. Natural
  split when next touched: move `StoredTemplateButton` + `parseButtons` into
  `wa-template-button-parsing.ts`.

## Lens notes

- **Wire shape**: QUICK_REPLY → `{ type: 'QUICK_REPLY', text }` with no `url`/`phoneNumber`
  keys, verified by JSON round-trip (`wa-template-form-types.test.ts:185-191`). COUPON_URL branch
  untouched (`:141-149`). PHONE_NUMBER keeps `phoneNumber: b.phoneNumber ?? ''` (`:155`) — the
  #97 key-presence contract holds; `createTemplateButton` and `applyTemplateButtonChange` are
  unchanged, and the dev proved the latter already clears both fields for QUICK_REPLY with a
  test rather than assuming it.
- **`parseButtons` rewrite**: behaviour change is limited to no longer carrying a stray `url`
  on a PHONE_NUMBER row (or `phoneNumber` on a URL row) into form state. The builder never
  emitted those for the other type anyway, so the request body is byte-identical for every
  previously-valid stored button. The COUPON_URL heuristic (`url.includes('/coupon/')`) is
  preserved as-is, correctly out of scope.
- **Domain alignment**: the form union (`URL | PHONE_NUMBER | COUPON_URL | QUICK_REPLY |
  UNSUPPORTED`) is a presentation view-model, not a mirror of
  `TemplateButtonType` (`src/domain/entities/whatsapp-template.ts:14-18`) — COUPON_URL is
  form sugar over URL, UNSUPPORTED is an opaque carrier. That is the right separation: the
  domain type is untouched, and the form imports nothing from the domain. The domain-side
  `validateButtons` (`validate-template-components.ts:44`) already accepts a label-only
  QUICK_REPLY, so no backend change was needed — the handoff's claim checks out.
- **Completeness (absence check)**: D6 names four deliverables (union, `<option>`, UNSUPPORTED
  mapping, verbatim re-emit) plus read-only rendering — all present. No route/nav/DI/permission
  wiring applies (the change is inside an existing form reachable at Templates → New/Edit). i18n:
  the buttons section is hard-coded English throughout (unlike its sibling
  `wa-template-form-fields.tsx`, which uses `next-intl`); the three new strings follow the
  file's existing style — pre-existing inconsistency, mention only.
- **Surgical Changes**: every changed line traces to #132 / D6. No adjacent refactors, no
  reformatting. Orphans: none.
- **Sizes for new code**: test file 104 lines; `parseButtons` 13 lines; UNSUPPORTED branch
  20 lines. Within targets.

## ✅ Strengths

- Tests were written at the layer where the bug lives: the JSON-round-trip `wireButtons`
  helper is exactly what catches the "key vanished on the wire" class (#97), and the new
  QUICK_REPLY case asserts key absence explicitly, not just equality.
- Byte-for-byte re-emit test for a round-tripped COPY_CODE (`:236-241`) closes the issue's
  "secondary" finding with a behavioural assertion, not a type-cast promise.
- The "unknown future Meta type → UNSUPPORTED" case (`:227-233`) makes the guard forward-
  compatible rather than a COPY_CODE special case.
- Handoff artifact is precise about what was verified vs assumed (e.g. the
  `applyTemplateButtonChange` no-change claim was test-backed).

## Open Questions

1. **API-side component schema (pre-existing, not introduced here)**: `POST`/`PATCH
   wa-templates` accept any `components[]` shape. Worth a follow-up ticket so the trust
   boundary is the route, not Meta's validator. Not a condition on this PR.
2. **Meta button grouping rule**: Meta rejects templates that interleave quick-reply and
   call-to-action buttons (e.g. `[URL, QUICK_REPLY, URL]`). Neither `validateWaTemplateButtons`
   nor domain `validateButtons` checks ordering; the tenant will see a `meta_rejected` 422 with
   Meta's wording. Acceptable for the D6 hotfix; a candidate for the "components Meta is certain
   to reject" gate when CAMP-004 is done.
3. **Kanban**: `.claude/kanban.json` CAMP-004 is not touched by this PR. Per recent history the
   orchestrator updates kanban in a separate `chore(kanban)` commit — confirming that is the
   intent here.
4. **Browser verification**: the handoff defers `ui-test-runner` to the combined CAMP-008
   landing. The `<select>` now has a matching option for stored QUICK_REPLY rows (previously the
   browser silently showed "URL"); a single in-browser pass of Flow 1 + Flow 2 from the handoff
   would close that.

## Verdict: CONDITIONAL

Approve on I1 (add the debugging journal). No code changes are required for approval; M1–M5
are optional and M1 is best folded into CAMP-004.

## Next Steps

1. Dev (or orchestrator): write `debugging_journals/2026-08-27-claim-mode-unreachable-quick-reply.md` (I1).
2. Optional in this PR if cheap: M3 (invoke Remove) and M4 (PHONE_NUMBER/URL row render cases).
3. Orchestrator: merge with the gemini-cli-reviewer lane worst-of; carry Open Questions 1–2
   into CAMP-004's scope note.
