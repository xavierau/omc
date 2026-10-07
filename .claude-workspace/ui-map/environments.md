# Environments

| env | baseUrl | testOrgId (or slug) | notes |
|-----|---------|----------------------|-------|
| dev | http://localhost:3000 (`./node_modules/.bin/next dev -p 3000` from the checkout under test) | 00000000-0000-4000-a000-000000000001 ("The Green Kitchen", status active) | dev Supabase project is ~30 migrations behind prod (no consent_records / import_batches / tags — memory `incident_no_browser_env_for_db_features`, issue #146): DB-backed steps may 4xx/5xx; client-only steps (e.g. import wizard `?step=csv`) work. **Confirmed present** (2026-09-09): `wa-template-media` storage bucket (migration 055) works end-to-end including upload — don't assume every bucket/migration gap applies without checking. **Confirmed missing** (2026-09-09): migration `058_restaurant_contact_config.sql` — `/dashboard/setup` 500s (`restaurants.redirect_number does not exist`), blocks tenant-logo-upload UI verification. Kapso media-ingest calls from this DEV key 404 with "WhatsApp configuration not found" regardless of payload (TPL-004/TPL-011 precedent) — inconclusive for provider-integration legs, not a DEV-bucket/migration problem. **Confirmed 2026-09-10 (INT-001)**: this "~30 migrations behind" note is now stale for migrations 069–073 specifically — `integration_settings`, `integration_settings_audit`, `integration_member_jobs`, `integration_member_refs`, `integration_events`, `integration_deliveries` all EXIST in Postgres (`information_schema` / a direct `supabase-js` `.select().limit(0)` on each returns no error) but PostgREST's schema cache on this project has not been reloaded since — every REST call to any of these tables 404s with `PGRST205 "Could not find the table … in the schema cache"`, reproduced identically via `curl` straight against `${SUPABASE_URL}/rest/v1/<table>` with both the anon and service-role key, consistently across 5+ retries over several minutes (not transient/flaky). `pos_integrations` and `consent_records` (pre-existing tables) are unaffected. No DB password and no Supabase Management API token are available in this worktree to force `NOTIFY pgrst, 'reload schema'` or an equivalent — needs a human with dashboard/Management-API access to reload the PostgREST schema cache (or a `supabase db push` cycle that triggers Supabase's own auto-reload) before any INT-001 dashboard flow past the pre-existing Inbound-credentials card can be browser-verified. Also confirmed: `next dev` alone does **not** load `.env.local` into a separately-run `npx tsx scripts/start-worker.ts` process — export the vars first (`set -a; source .env.local; set +a`) or the worker fails every DB call with `supabaseUrl is required`. `INT001_SECRET_KEY` / `INT_JOBID_KEY` were not present in this worktree's `.env.local` (`secret-box` and the job-id HMAC both throw without them per `src/infrastructure/crypto/secret-box.ts` / `src/application/build-member-job-id.ts`) — generated and appended (32 random bytes base64 / 32 random bytes hex) so the app and worker start cleanly; left in place for reuse, never committed (`.env.local` is gitignored). |
| staging | TODO | TODO | |
| prod | https://app.ohmyclient.io | TODO — need the tenant/org id (or slug) the pinned prod test account belongs to | admin console path unconfirmed, likely `/admin/*` |

## Breakpoints

- desktop: 1440x900 (default unless overridden here)
- mobile: 390x844
- tablet: 768x1024 (only when `layout scope: full`)

## Locales

en, zh-HK (`src/messages/en.json`, `src/messages/zh-HK.json`). **One locale per deployment**: `src/i18n/request.ts` reads `NEXT_PUBLIC_DEFAULT_LOCALE || 'zh-HK'` at build/start — there is no per-user switcher and no locale-prefixed route. A run therefore verifies the locale the server was started with; to see the other, restart the dev server with the env var changed. The other locale's strings are covered by `src/messages/__tests__/locale-parity.test.ts` + component tests.

## Frontend source root

`src` (Next.js app router: pages under `src/app`, components under `src/components`).
