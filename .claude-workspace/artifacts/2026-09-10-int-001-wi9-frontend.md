---
id: artifacts/2026-09-10-int-001-wi9-frontend
type: artifact
author: react-frontend-dev
created: 2026-09-10
status: active
supersedes: null
superseded_by: null
related: [plans/2026-09-10-int-001-member-creation-api, specs/2026-09-10-int-001-member-creation-api, kanban:INT-001, artifacts/2026-09-10-int-001-wi8-backend, artifacts/2026-09-10-int-001-wi0-backend]
---

# INT-001 WI-9 — Dashboard Integrations area (list + detail, settings cards, sidebar, i18n)

Implements plan `plans/2026-09-10-int-001-member-creation-api` §WI-9. Closes US-7, US-8 (UI
halves), spec §8.2/§8.3 feedback states, and T-M9 (escaped rendering). No API changes; no
member detail page; no delivery-log/activity-log/paused-banner/retry-resume UI (WI-10).

## Done

- Integrations list page (`/dashboard/integrations`): rows link into the detail page; an
  admin-only inline create form (name only — the pre-existing, untouched
  `POST /api/dashboard/pos-integrations` defaults `provider` to `'generic'` server-side).
  Added because without it the detail page is unreachable for a tenant with zero
  integrations (Surgical Changes: wiring is part of the ask; WI-12's own e2e walk expects
  "sidebar → create/open integration").
- Integration detail page (`/dashboard/integrations/[id]`): header (name/status/provider,
  T-M9-safe) + a `Tabs` split into **Settings** (this WI's four cards) and **Activity**
  (placeholder — WI-10's extension point, see below).
- Four settings cards, exactly as the plan's file list names them:
  - **Inbound credentials** — webhook URL (rebuilt client-side from `{origin}/api/webhooks/pos/{id}`,
    matching `configure-pos-integration.ts`'s own construction — no API change needed since
    it's deterministic), secret last4, **Rotate with a confirm step and show-once reveal**
    (WI-0's rotate-inbound-secret route only ever returns the new secret in that one response).
  - **Welcome template** — Off / Tenant default radios (OD-1 launch scope); a specific
    template id (API-set, post-launch UI) renders read-only with Off as the only other
    choice; helper copy per §8.3 incl. the MARKETING `consent_level: all` note and the
    `tenant_quality_paused` warning; `no_default_welcome_template` rejection links to
    `/dashboard/wa-templates`.
  - **Consent attestation** — text + acknowledgement, explains the OD-13 strong/weak rule.
  - **Outbound webhook** — URL, event checkboxes (`member.created` default on), PII
    acknowledgement, Enabled toggle (client-side gated on url+secret+ack, mirroring WI-1's
    frozen invariant so an invalid combination is never submitted), a **separate** secret
    PUT with a swap-warning confirm step (OD-9: partner-minted, never regenerated here,
    never re-displayed), and **Send test event** (WI-6's `sendTestEvent`, 202 + deliveryId;
    the live delivery-status row is WI-10's job — see extension point).
- Sidebar nav entry: `Settings` → **Integrations**, `/dashboard/integrations`, `Plug` icon
  (Integration Map #17).
- i18n: `nav.integrations` + 88 `integrations.*` keys in both `en` and `zh-HK` (Integration
  Map #19), covering every §8.2/§8.3 success/warning/rejected row and every settings/secret/
  test-event error code.
- Admin-only gating throughout: `GET .../settings` is server-gated to `requireTenantAdmin`
  (WI-8), so the detail page never even calls it for `staff` — it shows
  `adminOnlySettings` instead of fetching a guaranteed 403. Base integration info (name/
  status/provider, from the ungated base GET) stays visible to `staff`; the Rotate button
  and all four settings cards are admin-only.
- Escaped rendering (T-M9): integration names (owner-entered via the create form) and
  template names render through plain JSX text children — proven structurally with a
  `<script>`/`<img onerror>` string asserted present as literal text in two components.

## Files Changed

| File | Purpose |
|---|---|
| `src/hooks/integrations-client.ts` (new) | Fetch wrappers for every route WI-0/WI-8 shipped (list/detail/settings GET, settings PATCH, outbound-secret PUT, rotate-inbound-secret POST, outbound/test POST, create POST) + `isTenantAdmin` |
| `src/hooks/use-integrations.ts` (new) | `useIntegrationsList()`, `useIntegrationDetail(id)` — GET-only, mirrors `use-admin-tenant-detail.ts`'s `mutate` convention |
| `src/components/dashboard/integrations/settings-error-messages.ts` (new) | Pure error-code → i18n-key map covering every 400/422 code across settings/secret/test-event |
| `src/components/dashboard/integrations/integration-list.tsx` (new) | List + inline create (container + pure `IntegrationListView`) |
| `src/components/dashboard/integrations/integration-detail-header.tsx` (new) | Pure header (name/status/provider) |
| `src/components/dashboard/integrations/inbound-credentials-card.tsx` (new) | Container + pure `InboundCredentialsView` |
| `src/components/dashboard/integrations/welcome-template-card.tsx` (new) | Container + pure `WelcomeTemplateView` + `welcomeHelperState`/`initialWelcomeChoice`/`isLockedSpecific` |
| `src/components/dashboard/integrations/consent-attestation-card.tsx` (new) | Container + pure `ConsentAttestationView` + `attestationGrade` |
| `src/components/dashboard/integrations/outbound-webhook-card.tsx` (new) | Container + pure `OutboundWebhookView` + `canEnableOutbound`/`outboundStatusLabelKey`/`defaultOutboundEvents` |
| `src/app/dashboard/integrations/page.tsx` (new) | List route |
| `src/app/dashboard/integrations/[id]/page.tsx` (new) | Detail route (tabs, wires the four cards) |
| `src/components/dashboard/sidebar.tsx` (+9/-3) | New `secondaryNavItems()` pure export (testability) + the Integrations entry |
| `src/messages/en.json`, `zh-HK.json` (+89 lines each) | `nav.integrations` + 88 `integrations.*` keys, both locales, key-parity verified |
| 8 test files (`__tests__/`, 173 tests) | see Tests below |

## Routes / Nav Location

- List: `/dashboard/integrations` — reachable from the sidebar's secondary section
  (`Settings` → **Integrations**), `Plug` icon.
- Detail: `/dashboard/integrations/[id]` — reachable by clicking a list row, or by creating
  a new integration (the create form's `onCreate` reloads the list; the row link then opens
  the detail page — WI-9 does not auto-navigate to the new integration, a small deferred
  polish item, see Deferred).
- Verified in the Next.js production build output: both routes appear correctly
  (`○ /dashboard/integrations` static, `ƒ /dashboard/integrations/[id]` dynamic).

## i18n Keys Added

`nav.integrations` (1 key) + `integrations.*` (88 keys) in both `en.json` and `zh-HK.json`.
Full list and parity are pinned by `src/messages/__tests__/integrations-i18n-keys.test.ts`
(every key present + non-empty in both locales, and an exact-set check so an added-but-
untracked key fails loudly); `locale-parity.test.ts` (pre-existing, global) also covers the
whole-file key-set match and passes unchanged.

## Failing-then-Passing Evidence

**Deviation from strict test-first ordering, disclosed (matches WI-0's own precedent for
this exact situation):** components and their pure logic were authored together rather than
watching each test fail before writing its implementation, since the exact prop/return
shapes were derived up front from the frozen WI-8 route contracts and the plan/spec's
feedback-state tables — the same "derive contracts first" posture WI-1's DTO-first work
used. To still produce real red-then-green evidence rather than asserting it, I retroactively
verified the whole new suite after the fact:

- Moved all 9 new implementation files (`integrations-client.ts`, `use-integrations.ts`,
  `settings-error-messages.ts`, `integration-list.tsx`, `inbound-credentials-card.tsx`,
  `integration-detail-header.tsx`, `welcome-template-card.tsx`,
  `consent-attestation-card.tsx`, `outbound-webhook-card.tsx`) out of the tree and
  `git stash`'d the `sidebar.tsx`/`en.json`/`zh-HK.json` diffs.
- Ran the full new suite: **10 test files failed to even load** (`Cannot find module` for
  every moved file) **plus 7 assertion failures** in the i18n-keys and sidebar tests
  (missing `integrations.*` keys, `nav.integrations` undefined, `secondaryNavItems is not a
  function`) — one meaningful failure signature per removed piece, proving the suite
  actually exercises what it claims to.
- Restored all files (`git stash pop` + moved files back) and reran: **173/173 passed**
  (11 test files). No test was weakened, skipped, or deleted after being written.

## Tests

**173 new tests across 8 files** (`src/hooks/__tests__/integrations-client.test.ts`,
`src/components/dashboard/integrations/__tests__/{settings-error-messages,integration-list,
integration-detail-header,inbound-credentials-card,welcome-template-card,
consent-attestation-card,outbound-webhook-card}.test.ts(x)`,
`src/components/dashboard/__tests__/sidebar.test.tsx`) plus 1 new
`src/messages/__tests__/integrations-i18n-keys.test.ts`:

- **43** — every fetch wrapper in `integrations-client.ts` (mocked `fetch`, the exact
  `tag-client.test.ts` pattern) incl. every one of the 19 settings error codes round-tripped
  unchanged, both `outbound/test` codes, `network_error` on a thrown fetch, and
  `isTenantAdmin`'s four cases.
- **25** — `settingsErrorMessageKey`: all 24 known codes + the unrecognized-code fallback.
- **12** — `IntegrationListView`: admin-only create form, row rendering/linking, empty
  state, active/inactive badge text, and the escaped-rendering (`<script>`) assertion.
- **4** — `IntegrationDetailHeader`: name/provider/status rendering + escaped rendering.
- **14** — `InboundCredentialsView`: admin-only Rotate (hidden for staff even mid-flow),
  the full idle→confirming→rotating→revealed state machine, copy-affordance text swap.
- **25** — `welcomeHelperState`/`initialWelcomeChoice`/`isLockedSpecific` (pure) + the view:
  OD-1 launch choices, the locked-specific "Off as the only other choice" shape, helper
  copy per state, the `tenant_quality_paused` warning, the `no_default_welcome_template`
  rejection + template-page link.
- **12** — `attestationGrade` (pure, OD-13's strong/weak rule) + the view.
- **29** — `canEnableOutbound`/`outboundStatusLabelKey`/`defaultOutboundEvents` (pure) + the
  view: URL/events/PII/enabled wiring, the disabled-until-prerequisites Enabled checkbox
  and its hint, every URL 422 code, the secret idle/confirmingSwap/saving states, the test-
  event idle/sent/error states and the WI-10 extension-point mount node.
- **2** — `secondaryNavItems` (extracted pure export): the Integrations entry present,
  Settings entry untouched.
- **5** — i18n key presence (every `integrations.*` key + `nav.integrations`, both
  locales) + an exact-set check.

**Test technique**: this repo has no jsdom/RTL (`vitest.config.ts`: `globals: false`, no
`environment: 'jsdom'`) — confirmed against `use-admin-tenant-detail.ts`/`use-wa-templates.ts`,
neither of which has a test file for the same reason. Every card is split into a stateful
container (untested directly, matching that precedent) and a pure `*View` component
(props → JSX only), render-tree-walked via a shared helper extracted from
`contact-redirect-section.test.tsx`'s own local pattern into
`src/components/dashboard/integrations/__tests__/render-tree-test-utils.ts` (justified past
the third-use DRY threshold — six view components needed it). Verified empirically that
`next/link` and the shadcn `Badge` render safely through this trick (neither uses hooks
outside `asChild`); `Tabs` (a stateful Radix primitive, used only in the detail page) is
correctly left to browser verification, not unit-tested.

**Mechanical gate**: `npx tsc --noEmit` clean (0 errors) repo-wide. `npx eslint` clean (0
errors/warnings) on every file this WI touched or created, verified individually by path.
Full repo `npm run lint`: **149 errors / 22 warnings — unchanged from the pre-WI-9
baseline** (WI-0's own disclosed count was 149/20; the +2 warnings are WI-4/WI-7's
concurrent uncommitted work in this shared worktree, not mine) — my new files add zero new
lint findings. `npm run build` (production) succeeds; both new routes appear correctly in
its route table (`○ /dashboard/integrations`, `ƒ /dashboard/integrations/[id]`). Full
`npx vitest run`: **5347 passed / 2 failed / 24 skipped / 2 todo** on one run and
**5356 passed / 0 failed** on a clean rerun — the 2 failures (`client-interactive.test.ts`'s
`sendInteractiveList` cases) and two `[vitest-pool]: Failed to start forks worker` lines are
in files this WI never touches (Kapso client, `bulk-tags`/`execute-campaign-broadcast`),
non-deterministic across runs, and match this repo's own documented pre-existing flakiness
(`project_flaky_webhook_integration_tests.md`: shared-state pollution in the full suite,
"don't chase") compounded by WI-4/WI-7's concurrent edits in this same live worktree (the
exact cause WI-8's own handoff also disclosed for its transient failure pair). Not
reproducible against any WI-9 file in isolation.

## Extension Point for WI-10

- **Tab slot**: `[id]/page.tsx`'s `Tabs` has an `"activity"` `TabsTrigger`/`TabsContent`
  already wired (currently a placeholder paragraph, `data-testid="activity-tab-placeholder"`)
  — WI-10 mounts `delivery-log-table.tsx`, `activity-log-table.tsx` and `paused-banner.tsx`
  inside that `TabsContent`.
  - `outbound-webhook-card.tsx`'s "Send test event" button fires the POST and shows only
  the immediate `202`/`422` outcome (no live status) — a `data-testid="outbound-test-
  extension-point"` empty `<div>` marks where WI-10's `delivery-log-table.tsx` mounts to
  poll the row that test event created (per plan's WI-10 spec: "every 2s for 30s").
- **Status display, not the full paused-banner**: the outbound card shows a simple status
  badge (`outboundStatusLabelKey`, active/paused_auto/paused_manual) but not the failure-
  streak banner or a Resume button — that's WI-10's `paused-banner.tsx` per the plan's own
  WI-9/WI-10 split.
- `useIntegrationDetail`'s `mutate()` is exposed and available for WI-10 to call after a
  retry/resume action if it wants the settings view (e.g. `outboundFailureStreak`,
  `outboundStatus`) refreshed from the parent.

## Key Decisions

1. **Added a minimal create-integration form to the list page**, beyond the plan's literal
   WI-9 file list (which names `integration-list.tsx` but doesn't call out a create form).
   Without it, a tenant with zero integrations has no path to the detail page the plan
   explicitly requires — and WI-12's own end-to-end walk assumes "sidebar → create/open
   integration." Reuses the pre-existing, untouched `POST /api/dashboard/pos-integrations`
   (name only; `provider` defaults server-side). No API change.
2. **`GET .../settings` is never called for `staff`.** WI-8's settings GET route itself
   calls `requireTenantAdmin` (403 for staff) — rather than fetch-then-403, the detail page
   gates the call on the client-derived `isAdmin` (from `useTenant()`'s own `restaurants[].role`,
   already returned by the pre-existing `/api/me/tenants`) and shows `adminOnlySettings`
   instead. No provider change was needed.
3. **`outboundEnabled` is client-gated (disabled checkbox) rather than left to fail with
   `pii_ack_required`.** WI-1's frozen `IntegrationSettings.fromProps` invariant makes a
   save atomic — sending `outboundEnabled: true` without url+secret+ack fails the WHOLE
   patch (not just a partial "URL saved, enable rejected" as spec's §8.2 prose might read
   literally). `canEnableOutbound` mirrors that invariant client-side so the checkbox is
   simply unavailable until all three exist, and the 422 is still mapped/rendered
   defensively in case of a stale-state race. **Flagged for review**: this is a UX
   simplification of spec's literal copy, not a re-litigation of the invariant itself.
4. **`resolvedTemplate` is never guessed for an unsaved 'default' pick.** WI-8's GET/PATCH
   only resolves the template for the CURRENTLY SAVED `newJoinTemplateId` — there's no
   preview endpoint. `welcomeHelperState` shows a neutral "save to preview" line instead of
   fabricating a name for a selection that hasn't been persisted yet.
5. **No "by \<user\>" in the secret-updated / ack copy.** `IntegrationSettingsView` (WI-8)
   carries `outboundSecretUpdatedAt`/`consentAttestationAckAt` but no `*By` display name —
   only a user id lives in the audit trail, not surfaced in this view. Copy simplifies to
   "Updated \<when\>" per spec's intent, without the "by \<user\>" clause spec's literal §8.2
   text shows. Flagged for WI-8/product if a display name becomes available later.
6. **Extracted `secondaryNavItems()` and `IntegrationDetailHeader`/render-tree-test-utils.ts**
   beyond the plan's literal file list, solely for unit-testability against this repo's
   jsdom-free constraint (see Tests). All three are small, pure, and don't change `Sidebar`'s
   or the detail page's rendered output.
7. **`outbound-webhook-card.tsx` is 415 lines**, over the 150-line new-code target
   (`~/Code/.claude/rules/code-quality.md`). It intentionally co-locates the container, the
   pure view, and three pure helpers for one state machine (settings + secret + test-event
   are three related but independently-testable concerns) — matching this repo's own
   precedent (`contact-redirect-section.tsx`, 297 lines, doing the same container+view split
   for a comparably multi-part settings card). Splitting further would fragment one
   cohesive state machine across files for no readability gain; flagged rather than
   silently exceeding the budget.
8. **react-hooks-compiler's `set-state-in-effect` lint rule.** Empirically verified
   (documented in `use-integrations.ts`'s header comment) that this rule fires when a
   `useEffect` calls a locally-closed function containing a synchronous `setState` as its
   first statement, but NOT when the effect chains `.then()` directly on an imported fetch
   function (`tag-manager.tsx`'s own lint-clean precedent). `use-wa-templates.ts` and
   `use-admin-tenant-detail.ts` — the two hooks I was told to model against — both
   currently FAIL this rule (part of the pre-existing 149-error baseline); I did not fix
   them (out of boundary), but structured my own two new hooks to avoid the same failure so
   my touched-files lint stays green per the dispatch's acceptance bar.

## Deferred / Tech Debt

- Creating an integration does not auto-navigate to its detail page — the admin creates,
  then clicks the new row. Small, low-risk UX polish.
- No dashboard picker for a specific `new_join_template_id` (OD-1: explicitly post-launch;
  the read-only display for an API-set specific id IS implemented).
- Inbound `webhookUrl` is rebuilt client-side from `window.location.origin` rather than
  read from any API field (none exists past create-time) — correct in every deployment this
  app currently has (`NEXT_PUBLIC_APP_URL`/`VERCEL_URL` and the browser's own origin should
  always agree), but worth a WI-8 follow-up if that ever diverges (e.g. a proxy rewriting
  the public hostname).
- `outboundEvents` toggle logic re-derives the array on every change
  (`prev.filter(...).concat/filter`) rather than a `Set` — fine at 2 possible events, not a
  pattern to copy if the event list grows.
- No repository-level UI test for "create with an already-taken name" (the API's own
  behavior there is untested by WI-0/WI-8 either — no uniqueness constraint observed on
  `pos_integrations.name` in the schema).

## Review Hand-off

- **Key Decision 3 (client-gated Enabled checkbox) is the highest-value item to re-verify**
  — it's the one place this WI reinterprets spec's literal §8.2 copy ("Saved, but no PII
  acknowledgement → outbound stays Disabled") against WI-8's actual atomic-merge
  implementation, rather than the API's frozen behavior changing.
- **Key Decision 2 (skip settings GET for staff)** is the one piece of new authorization-
  adjacent client logic in this WI — worth confirming it can't be raced by a stale
  `isAdmin` (e.g. a role downgrade mid-session): the GET route's own `requireTenantAdmin`
  is still the authoritative guard either way, so a race here degrades to an extra 403 the
  UI doesn't yet special-case, not a security gap.
- Browser verification (ui-test-runner) still needs to walk: the create flow end-to-end,
  the rotate/reveal-once flow, the welcome-template save + warning/rejection copy, the
  outbound secret swap-warning + test-event send, and staff vs. admin views on a real
  session — none of that is exercised by this render-tree suite, by design (see Tests).
