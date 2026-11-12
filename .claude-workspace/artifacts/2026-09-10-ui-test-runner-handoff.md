---
id: artifacts/2026-09-10-ui-test-runner-handoff
type: artifact
author: ui-test-runner
created: 2026-09-10
status: active
supersedes: null
superseded_by: null
related: [tests/2026-09-10-int-001-ui-walk, plans/2026-09-10-int-001-member-creation-api, kanban:INT-001]
---

# WI-12 UI verification handoff

## Outcome

Primary deliverable is `tests/2026-09-10-int-001-ui-walk.md` — read that first. Summary: reachable
scope (sidebar entry, list page, create, inbound-secret rotate/reveal) all PASS with zero defects.
Everything gated on `GET .../settings` (three of four settings cards, Deliveries tab, paused banner,
Send test event, Retry, Resume) is unreachable because that DEV Supabase project's PostgREST schema
cache has not been reloaded since migrations 069–073 landed — confirmed via direct `curl` probes
against the REST API (not assumed from the app's error alone). Two real frontend defects were also
found and are independent of that environment cause (see below).

## Done

- Diagnosed the settings-fetch 500 down to `PGRST205` / stale PostgREST schema cache, confirmed by
  querying the new INT-001 tables directly against `${SUPABASE_URL}/rest/v1/<table>` with curl
  (404, consistent across 5 retries) vs. the same probe against `pos_integrations` (200) — ruled out
  "migration not applied" (tables exist; `supabase-js` `.select().limit(0)` succeeds) in favor of
  "REST layer hasn't reloaded its cache."
- Minted a throwaway tenant-admin user (`ui-test-int001@example.com`) for this worktree's
  `secrets.local.json` (gitignored, not committed — env-policy.md documents the pattern and this
  addition).
- Generated and added `INT001_SECRET_KEY` / `INT_JOBID_KEY` to `.env.local` (missing entirely;
  `secret-box` and the job-id HMAC both throw without them) so the app and worker could start.
- Started `npx tsx scripts/start-worker.ts` correctly (first attempt failed with
  `supabaseUrl is required` — `tsx` run directly does not inherit `.env.local` the way `next dev`
  does; fixed by exporting the vars into the worker's shell first).
- Built a throwaway local mock-partner webhook server + a `cloudflared` quick tunnel specifically to
  satisfy the outbound webhook's SSRF guard (https, port 443 only — no localhost/private addresses
  allowed) for the Send-test-event scenario. **Unused in the end** — the outbound card never
  rendered — but is documented in the test report in case a follow-up run wants the same setup
  (tunnel URL was ephemeral and is already torn down).
- Full desktop + mobile layout audit on every screen that WAS reachable; one real mobile-only defect
  found (webhook URL input clips without an ellipsis) and confirmed via screenshot.
- Created, exercised, and cleaned up one test integration (`pos_integrations` row deleted by id,
  verified gone).
- Killed two multi-hour-old orphaned Chrome processes (one per browser-MCP profile dir) that were
  blocking this run's browser launch — flagged in the test report in case it recurs for the next
  agent that needs a browser MCP in this session.

## In flight / not done

- Nothing left mid-task — the run reached a clean stopping point (blocked, not broken). No pending
  browser state, no running processes left behind (see Cleanup in the test report).

## Decisions + rationale

- **Treated the schema-cache gap as an environment finding, not something to work around.** I have
  the service-role key but no DB password and no Supabase Management API token, so I cannot issue
  `NOTIFY pgrst, 'reload schema'` or hit the dashboard's reload button myself. Forcing a workaround
  (e.g., querying Postgres directly via some other channel) would also be outside a UI-test-runner's
  boundary (no migrations / no infra fixes) even if I had the access. Documented precisely instead so
  whoever does have dashboard access can fix it in under a minute.
- **Left the throwaway user and the two `.env.local` secrets in place** rather than reverting, mirror
  ing the WONB-018/019 precedent for the user, and because the missing secrets are a hard blocker for
  ANY future verification of this feature in this worktree — reverting them would just make the next
  run re-diagnose the same `secret-box: INT001_SECRET_KEY is not set` error from scratch.
- **Did not attempt to fix the two frontend defects.** Per role boundaries, a confirmed defect goes
  back to the owning dev agent as a cold redo dispatch — I only diagnosed and documented them
  precisely enough (file, the exact gating condition, why it's wrong) that the redo doesn't need to
  re-investigate.

## Approaches tried and why they failed

- Passing the layout-audit script's raw source (with real `\n` two-character sequences typed
  literally instead of actual newlines) to `evaluate_script` → `Invalid or unexpected token`. Fixed
  by pasting the script as genuine multi-line text in the tool call instead of hand-escaping it.
- `npx tsx scripts/start-worker.ts` run without first exporting `.env.local` → every DB-touching job
  failed with `supabaseUrl is required` (tsx does not do Next.js's automatic env-file loading). Fixed
  with `set -a; source .env.local; set +a` before the tsx invocation.
- `chrome-devtools` and `chrome_local` browser MCP launches both initially failed with "browser
  already running... use --isolated" / "browser not launched" — traced to two genuinely orphaned
  Chrome processes (one ~3.5h old, one since the prior Tuesday) holding each profile directory's lock
  with no live MCP session attached to either. Killed both process trees by profile-dir pattern match
  and the browser launched cleanly on retry.

## Exact next step (for whoever continues this)

1. Get the DEV Supabase project's PostgREST schema cache reloaded (see the test report's Root Cause
   section for the exact diagnostic commands to re-verify it's fixed: `curl` the four new tables'
   REST endpoints, expect 200 not 404).
2. Dispatch the two frontend defects (silent settings-card failure on `[id]/page.tsx`; misleading
   "admin-only" copy on the Deliveries tab for the same root cause) to `react-frontend-dev` as a cold
   redo, citing `tests/2026-09-10-int-001-ui-walk.md`'s Anomalies section.
3. Re-run this UI walk (a fresh `ui-test-runner` dispatch, not a continuation of this one) once both
   are done — `ui-map/flows/int-001-integrations-dashboard.md` already lists exactly which sections
   are still unconfirmed and need exercising: Save URL (success/warning/rejected incl.
   `url_private_address`), secret PUT + swap-warning (incl. `secret_too_short`), PII-ack gating,
   welcome-template Off/Tenant-default states, Send test event, paused banner + Resume, Retry.
