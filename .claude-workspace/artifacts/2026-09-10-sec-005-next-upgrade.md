---
id: artifacts/2026-09-10-sec-005-next-upgrade
type: artifact
author: senior-backend-dev
created: 2026-09-10
status: active
supersedes: null
superseded_by: null
related: [kanban:SEC-005, kanban:INT-001, threats/2026-09-10-int-001-member-creation-api]
---

# SEC-005 — next 16.2.1 → 16.3.4 upgrade

## Version chosen and why

`next` 16.2.1 → **16.3.4** (latest stable on this registry), `eslint-config-next` bumped in
lockstep to 16.3.4 (no other `@next/*` peers in the lockfile).

`npm audit --omit=dev` on the pre-upgrade tree flagged `next` critical, with the `fixAvailable`
field itself pointing at 16.3.4. The six advisories named in the work item are all closed by
16.2.6 already, but two **critical** RCEs discovered since — GHSA-p293-qw3h-jr36 (unauthenticated
RCE on Windows-hosted servers via path traversal) and GHSA-2xp9-vwfh-vxw4 (unauthenticated RCE in
the Image Optimization API via AVIF) — only close at **>=16.3.3**. Staying on any 16.2.x branch
would leave both open, so 16.3.4 (not a 16.2.x patch) is the correct target.

Full advisory list closed by this bump (`next` no longer appears at all in
`npm audit --omit=dev` after the upgrade):
GHSA-q4gf-8mx6-v5v3, GHSA-8h8q-6873-q5fj, GHSA-26hh-7cqf-hhc6, GHSA-3g8h-86w9-wvmq,
GHSA-ffhc-5mcf-pf4q, GHSA-vfv6-92ff-j949, GHSA-gx5p-jg67-6x7h, GHSA-mg66-mrh9-m8jx,
GHSA-h64f-5h5j-jqjh, GHSA-c4j6-fc7j-m34r, GHSA-492v-c6pp-mqqv, GHSA-wfc6-r584-vfw7,
GHSA-267c-6grr-h53f, GHSA-36qx-fr4f-26g5, GHSA-6gpp-xcg3-4w24, GHSA-m99w-x7hq-7vfj,
GHSA-89xv-2m56-2m9x, GHSA-68g3-v927-f742, GHSA-4633-3j49-mh5q, GHSA-4c39-4ccg-62r3,
GHSA-p9j2-gv94-2wf4, GHSA-q8wf-6r8g-63ch, GHSA-955p-x3mx-jcvp, GHSA-p293-qw3h-jr36,
GHSA-2xp9-vwfh-vxw4.

**Registry caveat**: this npm registry serves synthetic version metadata — every 16.x patch
from 16.2.2 through the 16.4.0 canary line shares one identical publish timestamp
(`2026-09-09T23:56:55.479Z`). Publish-cadence/timing signals are not meaningful here; the
supply-chain verdict below relies on provenance and script inspection instead.

## Breaking changes

None applicable. Context7's Next.js upgrade docs state the only generated change for the
16.2→16.3 upgrade path is the `cache-components-instant-false` codemod, and that it is "purely
additive — no stable breaking changes exist for this upgrade path." That codemod only fires when
`cacheComponents` is enabled in `next.config.ts`; this repo does not set it. The repo already
uses `src/proxy.ts` (not `middleware.ts`), so the earlier v16.0 `middleware`→`proxy` rename is
not in scope for this bump. Diff is exactly 2 lines in `package.json` (`next`, `eslint-config-next`)
plus the resulting `package-lock.json` regeneration — no config file changes were required.

## Supply-chain verdict (supply-chain-guard skill)

**Clean.** Zero hits against the skill's known-compromised-package database. Both packages
publish via npm's OIDC trusted-publisher flow from GitHub Actions, list known legitimate
Vercel/Next.js maintainer accounts (including Tim Neutkens on `eslint-config-next`), point at
the real `github.com/vercel/next.js` repository, and declare no `preinstall`/`postinstall`
scripts. See the registry caveat above — this verdict does not rely on publish-timing signals.

## Verification results

| Check | Result |
|---|---|
| `npm audit --omit=dev` | `next` no longer listed (was critical, 25 advisories total pre-upgrade → 21 unrelated-package advisories remain, none touching `next`) |
| `npx tsc --noEmit` | clean |
| `npx eslint` | pre-existing baseline unchanged: 149 errors before AND after (confirmed via `git stash` A/B) — not caused by this upgrade, out of scope per Surgical Changes. One **new warning** (not error): refined `@next/next/no-location-assign-relative-destination` rule now flags `src/components/dashboard/sidebar.tsx:132` (`window.location.href` navigation). Non-blocking, doesn't change lint's exit code. Worth a follow-up ticket. |
| `npm run build` | succeeds, `BUILD_ID` generated; route list includes all four INT-001 integration routes (`/api/integrations/[integrationId]/members`, `.../members/jobs/[jobId]`, `.../points/add`, `.../points/deduct`) |
| `RELEASE_DRY_RUN=1 RELEASE_SKIP_BUILD=1 bash scripts/release.sh` | dry run completes clean: bundle staged (143M / 7331 files), secret scrub clean, inlined-credential scan clean, nothing pushed |
| `npx vitest run` | **NOT green — see blocking finding below** |

## BLOCKING FINDING — do not merge without further investigation

Three webhook integration test files fail under next 16.3.x, and this is **not** the documented
CI-001 flakiness (that pattern is known to pass in isolation; this does not):

- `src/app/api/webhooks/whatsapp/__tests__/route.quality-event.integration.test.ts` (WAQ-006)
- `src/app/api/webhooks/whatsapp/__tests__/route.status-event.integration.test.ts` (WAQ-002)
- `src/app/api/webhooks/whatsapp/__tests__/route.window-tracking.integration.test.ts` (WAQ-008)

**Evidence (bisected via `git stash` swapping only the `next` version, everything else held
constant):**
- On `next@16.2.1`: all three files pass cleanly, every run, alone or together.
- On `next@16.3.4` AND `next@16.3.3` (both tested): fail deterministically — either a hard
  5000ms+ test timeout, or duplicate/tripled row-count assertions (e.g. `expect(qualityEvents)
  .toHaveLength(1)` receiving 2 or 3).
- Instrumented with temporary trace points (reverted, not committed): the root symptom is
  `await import('../route')` inside each test's `postWebhook()` helper hanging **indefinitely**
  (confirmed to 30s+, not merely slow) on a cold vitest worker under 16.3.x, while resolving in
  under a second under 16.2.1. In full-suite runs (module cached after the first hit) the same
  files instead show the duplicate-row symptom, consistent with a timed-out test's orphaned
  promise chain completing late and mutating shared in-memory mock state during a later test.
- Ruled out: the documented 16.2→16.3 breaking change (not applicable — `cacheComponents` is
  off); unmocked network calls (`SLACK_WEBHOOK_URL_CS`/`_PLATFORM` are unset in `.env.local`, so
  `notifyOpsAlert`/`slack-notifier.ts` always short-circuits before any `fetch`); cross-file
  worker concurrency (reproduces with a single file, single test, run alone).
- Notably, `npm run build` (Turbopack-based module resolution) succeeds without issue — the hang
  is specific to vitest's Node-native dynamic `import()` path, not a general failure to resolve
  `next/server`. That, combined with the registry's synthetic version metadata, leaves open the
  possibility this is an artifact of an incomplete 16.3.x package build in this sandbox registry
  rather than a genuine upstream Next.js defect. Could not confirm either way within budget.

**Why no source fix was attempted**: the "no source changes beyond what the upgrade forces"
boundary does not cover blind-patching an unrelated-looking async regression in production
webhook idempotency code (WAQ-002/006/008 — quality-state transitions, delivery-status updates,
24h conversation-window tracking) without a confirmed root cause. The stakes (duplicate webhook
processing in production) warrant a dedicated investigation rather than a guess.

**Recommendation**: dispatch `bug-hunter` on the specific `await import('../route')` hang before
merging, or reproduce against a real npm registry to rule out a sandbox package-build artifact.

## Deferred / tech debt

- One new ESLint warning (`@next/next/no-location-assign-relative-destination` at
  `src/components/dashboard/sidebar.tsx:132`) — non-blocking, not fixed here (would be a source
  change beyond what the upgrade strictly forces; flagging for a follow-up ticket instead).
- Pre-existing 149 ESLint errors, unrelated to this upgrade — confirmed unchanged, out of scope.
- The vitest regression above is the primary open item blocking merge.

## Review hand-off

- Reviewers: focus on whether the webhook-hang finding changes the release decision. This PR's
  diff is clean and minimal (2 lines + lockfile), but the target branch has a demonstrated,
  reproducible test regression under next 16.3.x that I could not root-cause within budget.
- If a real Next.js 16.3.x release (outside this sandbox registry) is available to test against,
  that would be the fastest way to settle whether this is a genuine upstream defect.
