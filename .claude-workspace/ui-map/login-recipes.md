# Login Recipes

## Recipe A — real UI login (default; required on staging/prod)

Confirmed 2026-08-28 (dev):
1. Navigate to `<baseUrl>/login`.
2. Fill `#email` and `#password` (`src/components/auth/login-form.tsx`), submit `button[type=submit]`.
3. The page calls `supabase.auth.signInWithPassword`, then `GET /api/me/tenants`; with exactly ONE tenant it sets the cookie `x-tenant-id=<restaurantId>` itself and `router.push('/dashboard')`; with several it shows a tenant picker (click the org). Wait for the `/dashboard` URL.
4. Identity pin: the cookie `x-tenant-id` must equal `secrets.local.json[env].testOrgId`; every `/api/dashboard/*` call is scoped by it (`src/infrastructure/supabase/guards/tenant-guard.ts`).

Credentials come from `secrets.local.json[env].users[role]` — never hardcode here.

## Recipe B — token fast-path (dev only, NEVER staging/prod)

None needed — real-UI login (recipe A) works on dev. (A password grant against `<SUPABASE_URL>/auth/v1/token?grant_type=password` with the anon key returns a session, but the app also needs the `x-tenant-id` cookie, so drive the UI.)

## Roles needed for this project

- **tenant admin / staff** — for campaign builder, wa-templates page (issues #103, #102 tenant side)
- **platform admin** — for `/admin/template-reviews` (issue #102 admin side). TODO: confirm
  whether this is a separate login surface/domain or a role flag on the same account.
