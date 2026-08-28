# Environments

| env | baseUrl | testOrgId (or slug) | notes |
|-----|---------|----------------------|-------|
| dev | http://localhost:3000 (`./node_modules/.bin/next dev -p 3000` from the checkout under test) | 00000000-0000-4000-a000-000000000001 ("The Green Kitchen", status active) | dev Supabase project is ~30 migrations behind prod (no consent_records / import_batches / tags — memory `incident_no_browser_env_for_db_features`, issue #146): DB-backed steps may 4xx/5xx; client-only steps (e.g. import wizard `?step=csv`) work |
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
