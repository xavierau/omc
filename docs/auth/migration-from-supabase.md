# Migration: Supabase Auth → Keycloak (`fnb-platform` realm)

## TL;DR

This is the step-by-step playbook for moving `whatsapp-crm` off Supabase Auth and onto the shared Keycloak `fnb-platform` realm, while keeping Supabase Postgres as the data store. It is written for the engineer executing the cutover (likely 12–18 months out, when scale or enterprise needs force the move). Follow it linearly: pre-flight, Step 0 (only if needed), Steps 1–6, then validation. Total focused effort: **1–2 weeks**.

---

## When to do this migration (decision criteria)

**Triggers — do it when any of these is true:**

- Supabase Auth MAU pricing tier is hurting margin or about to step up
- A tenant requires SSO/SAML federation against their corporate IdP
- We need fine-grained delegated admin (per-tenant admin roles managed by tenant owners)
- A customer requires on-prem or single-region deployment Supabase can't satisfy
- We are onboarding a second app on the platform that must share identity with `whatsapp-crm`

**Anti-triggers — do NOT do it for these:**

- "Keycloak is cool / more standard / OIDC-native" — true, but not a reason on its own
- "We might need SSO eventually" — wait until a customer has signed a contract requiring it
- A single feature gap (e.g., custom email templates) — usually solvable inside Supabase first

This migration costs 1–2 weeks of focused engineering and one maintenance window. Do not do it for vanity.

---

## Pre-flight checklist

Tick every box before opening the maintenance window.

- [ ] Production Supabase DB backed up (point-in-time recovery enabled **and** a fresh `pg_dump` logical export taken in the last hour)
- [ ] Keycloak instance running and healthy in the **target environment** (HA prod cluster, not the local dev compose file in `/Users/xavierau/Code/keycloak-local`)
- [ ] Realm `fnb-platform` exists in prod Keycloak and `whatsapp-crm` client is configured with **production** redirect URIs (replace the `localhost` entries shipped in `/Users/xavierau/Code/keycloak-local/realm-export/fnb-platform-realm.json:74-77` with `https://app.ohmyclient.io/*`)
- [ ] All RLS policies use `app.current_user_id()` not `auth.uid()` directly — if not, do **Step 0** first
- [ ] Claim-mapping layer exists in app code (single file `/src/lib/auth/claims.ts` is the only place that reads JWT fields; rest of code calls `getUserId()`, `getRoles()`, etc.)
- [ ] Maintenance window scheduled — **estimate 30 min hard downtime** for the cutover (export + Keycloak partial-import + env flip + smoke test). Add 15 min buffer per 10k users.
- [ ] Email and SMS templates ported to Keycloak realm settings (Login → Emails tab; verify-email, reset-password, executions). Test send to a real inbox.
- [ ] Keycloak SMTP configured and **test email actually delivered** (not just "no error")
- [ ] On-call comms ready: every active user will be logged out at cutover and must log back in via the new flow. Send notice 48h ahead in zh-HK.
- [ ] Feature flag / env var `AUTH_PROVIDER` deployed in app (values: `supabase` | `keycloak`) — defaults to `supabase` until cutover

---

## Step 0 (only if needed): Decouple from `auth.uid()`

Skip this step **only** if a grep over `supabase/migrations/` returns zero hits for `auth.uid()`. Otherwise, do it 1–2 weeks ahead of cutover and ship to prod with no functional change.

### 0.1 — Add the indirection function

New migration file `supabase/migrations/0XX_app_current_user_id.sql`:

```sql
-- Reads the user id from a session GUC that the application sets after JWT validation.
-- Returns NULL if unset (defensive: RLS will then deny by default).
CREATE OR REPLACE FUNCTION app.current_user_id()
RETURNS uuid
LANGUAGE sql STABLE
AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid
$$;

-- Schema must exist
CREATE SCHEMA IF NOT EXISTS app;
GRANT USAGE ON SCHEMA app TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION app.current_user_id() TO authenticated, anon, service_role;
```

### 0.2 — Rewrite RLS policies

Mechanical search-and-replace across every file in `/Users/xavierau/Code/js/whatsapp-crm/supabase/migrations/`:

```sql
-- Pattern: anywhere a policy references auth.uid(), swap in app.current_user_id()
-- Example, before:
CREATE POLICY user_tenants_self_read ON user_tenants
  FOR SELECT USING (user_id = auth.uid());

-- After:
CREATE POLICY user_tenants_self_read ON user_tenants
  FOR SELECT USING (user_id = app.current_user_id());
```

Generate the rewrite migration `supabase/migrations/0XX_swap_auth_uid_for_app_current_user_id.sql` that drops and recreates each affected policy. Audit with:

```bash
grep -rn "auth.uid()" supabase/migrations/
# Expected after this step: zero hits in policies; only acceptable hits are inside auth.* schema files (Supabase-managed) which we will retire.
```

### 0.3 — Set the GUC after JWT validation

While still on Supabase, the GUC must mirror `auth.uid()`. Add to the request lifecycle in `/Users/xavierau/Code/js/whatsapp-crm/src/proxy.ts` (and any server-side data path that opens a Supabase client):

```ts
// After resolving `user`, set the session GUC for the duration of the request.
// `set_config(..., true)` makes it transaction-local; use `false` if your client
// reuses connections across statements without a transaction.
await supabase.rpc('set_config', {
  name: 'app.user_id',
  value: user.id,
  is_local: true,
})
```

Verify against current `@supabase/ssr` docs that `rpc('set_config', ...)` runs in the same connection as the subsequent query (verify against current docs). If not, wrap data access in an explicit transaction or use a PG function that does both in one round-trip.

After this step ships, RLS behaviour is identical but the dependency on `auth.uid()` is gone. You can now swap the identity source without touching any policy.

---

## Step 1: Export users from Supabase

Run from a psql session against the prod Supabase DB (read-only role is fine):

```sql
COPY (
  SELECT
    id,
    email,
    email_confirmed_at,
    encrypted_password,
    raw_user_meta_data,
    raw_app_meta_data,
    created_at,
    last_sign_in_at
  FROM auth.users
  WHERE deleted_at IS NULL
) TO STDOUT WITH (FORMAT csv, HEADER true);
```

Save to `users-export-YYYYMMDD.csv`. For pipelines preferring JSON:

```sql
COPY (
  SELECT json_agg(row_to_json(u))
  FROM (
    SELECT id, email, email_confirmed_at, encrypted_password,
           raw_user_meta_data, raw_app_meta_data,
           created_at, last_sign_in_at
    FROM auth.users
    WHERE deleted_at IS NULL
  ) u
) TO STDOUT;
```

**This exports only native email/password users.** Social-login users (Google, GitHub via Supabase) appear in `auth.users` but their `encrypted_password` will be NULL or a placeholder. Filter them out for this export and handle separately:

```sql
-- Identify social users for separate handling (Phase 2 follow-up).
SELECT id, email, raw_app_meta_data->'provider' AS provider
FROM auth.users
WHERE deleted_at IS NULL
  AND (encrypted_password IS NULL OR encrypted_password = '');
```

> ⚠️ **Phase 2 (out of scope here):** Social-login users will re-link via Keycloak Identity Brokering on first login after cutover. For the migration, we import them as enabled Keycloak users with no password credential and rely on the brokered IdP flow to attach the social identity. They cannot log in with a password until they reset it.

---

## Step 2: Transform export to Keycloak Partial Import format

Write a transform script (Node or Python — your choice; do not commit it to the app repo, keep it in `scripts/migration/`). It reads the export and emits one JSON file per 500-user batch in Keycloak's [Partial Import](https://www.keycloak.org/docs-api/latest/rest-api/index.html#_partial-imports) shape (verify against current Keycloak docs for your version).

### Target JSON shape

```json
{
  "ifResourceExists": "SKIP",
  "users": [
    {
      "id": "8b1d2c3e-...-supabase-uuid",
      "username": "alice@example.com",
      "email": "alice@example.com",
      "emailVerified": true,
      "enabled": true,
      "createdTimestamp": 1700000000000,
      "credentials": [
        {
          "type": "password",
          "algorithm": "bcrypt",
          "hashIterations": 10,
          "hashedSaltedValue": "<bcrypt-hash-no-prefix>",
          "salt": "<bcrypt-salt>",
          "secretData": "{\"value\":\"<bcrypt-hash-no-prefix>\",\"salt\":\"<bcrypt-salt>\"}",
          "credentialData": "{\"hashIterations\":10,\"algorithm\":\"bcrypt\"}"
        }
      ],
      "realmRoles": ["tenant-admin"],
      "attributes": {
        "supabase_legacy_id": ["8b1d2c3e-..."]
      }
    }
  ]
}
```

### Bcrypt mapping

Supabase stores the full Modular Crypt Format string in `auth.users.encrypted_password`:

```
$2a$10$N9qo8uLOickgx2ZMRZoMye.IjPHGc8h0nmWmyQ5dq9z.SBe5p1.7y
└┬┘ └┬┘ └──────────────────┬──────────────────┘└───────┬────┘
 │   │              salt (22 chars, base64)        hash (31 chars, base64)
 │   cost (== hashIterations)
 algorithm version
```

Split it as follows:

| MCF field      | Keycloak field                  |
|----------------|---------------------------------|
| `2a` / `2b`    | `algorithm: "bcrypt"`           |
| `10` (cost)    | `hashIterations: 10`            |
| 22-char salt   | `salt`                          |
| 31-char hash   | `hashedSaltedValue`             |

**Verify against current Keycloak docs** — recent Keycloak versions (24+) prefer the JSON-encoded `secretData` + `credentialData` shape over the legacy flat fields. If targeting Keycloak ≥ 24, populate both `secretData` and `credentialData` as JSON strings and omit the flat fields.

### Role assignment

Cross-reference the export with the existing Postgres tables to build `realmRoles[]`:

```sql
-- Platform admins → "platform-admin" realm role
SELECT user_id FROM platform_admins;
-- See /Users/xavierau/Code/js/whatsapp-crm/supabase/migrations/011_multi_tenant_platform_admin.sql:13-18

-- Tenant members → "tenant-admin" or "tenant-staff" based on role column
SELECT user_id, role FROM user_tenants;
-- See /Users/xavierau/Code/js/whatsapp-crm/supabase/migrations/011_multi_tenant_platform_admin.sql:1-9
```

Map `user_tenants.role`:

| `user_tenants.role` | Keycloak realm role |
|---------------------|---------------------|
| `admin`             | `tenant-admin`      |
| `staff`             | `tenant-staff`      |

Realm roles are pre-defined in `/Users/xavierau/Code/keycloak-local/realm-export/fnb-platform-realm.json:35-58`.

> ⚠️ **Phase 2 (out of scope here):** the `tenant_id` itself does not become a JWT claim in this migration — it stays in the `user_tenants` Postgres table and is selected via the existing tenant picker. Phase 2 adds a Keycloak protocol mapper that injects `tenant_id` and `tenant_role` claims by calling the Tenant Service.

---

## Step 3: Import into Keycloak

Use the Admin REST API. Get an admin token first:

```bash
ADMIN_TOKEN=$(curl -s -X POST \
  "https://keycloak.example.com/realms/master/protocol/openid-connect/token" \
  -d "client_id=admin-cli" \
  -d "username=$KC_ADMIN_USER" \
  -d "password=$KC_ADMIN_PASS" \
  -d "grant_type=password" | jq -r .access_token)
```

POST each batch:

```bash
for batch in batches/*.json; do
  echo "Importing $batch..."
  curl -fsS -X POST \
    "https://keycloak.example.com/admin/realms/fnb-platform/partialImport" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    --data-binary "@$batch"
  echo
done
```

Note: `ifResourceExists: "SKIP"` makes the import idempotent — safe to re-run if a batch fails midway.

### Verify

```bash
# User count in Keycloak
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  "https://keycloak.example.com/admin/realms/fnb-platform/users/count"

# Expected: matches the row count from your Step 1 export
```

Spot-check a known user can authenticate via direct grant (only enable `directAccessGrantsEnabled` on the client temporarily, then disable):

```bash
curl -s -X POST \
  "https://keycloak.example.com/realms/fnb-platform/protocol/openid-connect/token" \
  -d "client_id=whatsapp-crm" \
  -d "username=known-user@example.com" \
  -d "password=their-real-password" \
  -d "grant_type=password" | jq .
```

A 200 with an access token confirms the bcrypt mapping is correct.

---

## Step 4: Update whatsapp-crm code

These changes ship behind the `AUTH_PROVIDER` env flag — both providers coexist until cutover.

### Dependencies

| Action | Package |
|--------|---------|
| Remove (later, after cutover) | `@supabase/ssr` (only its auth surface; keep if used elsewhere) |
| Remove (later) | `@supabase/auth-helpers-nextjs` if present |
| Add | `next-auth@5` with the Keycloak provider (verify against current `next-auth` v5 / Auth.js docs — API stabilised in late 2024) |
| Keep | `@supabase/supabase-js` for **data access only** (use the service role key, not user JWTs, since RLS is now driven by `app.current_user_id()`) |

### Files that change

| File | Change |
|------|--------|
| `/Users/xavierau/Code/js/whatsapp-crm/src/proxy.ts` (the Next middleware, exported as `proxy` and re-exported by `middleware.ts` per Next 16 convention) | Replace Supabase session check at lines 7–27 and 31–46 with an Auth.js session check. Keep `isTenantBlocked` (lines 52–73) and `setSecurityHeaders` (lines 81–86) untouched. |
| `/Users/xavierau/Code/js/whatsapp-crm/src/app/login/page.tsx` | Remove `signInWithPassword` at lines 40–50. Replace with `signIn('keycloak')` redirect (Auth.js). The tenant-picker logic at lines 52–69 stays — `/api/me/tenants` still works once it reads `userId` from the new claim layer. |
| `/Users/xavierau/Code/js/whatsapp-crm/src/app/admin/login/page.tsx` | Remove the entire form (lines 18–60). Redirect to `signIn('keycloak', { callbackUrl: '/admin' })`. The `platform_admins` lookup at lines 42–53 moves into a server-side guard. |
| `/Users/xavierau/Code/js/whatsapp-crm/src/infrastructure/supabase/guards/auth-guard.ts` | Replace `getAuthSession` body (lines 9–18). Read session from Auth.js (`auth()` from `next-auth`) instead of `supabase.auth.getUser()`. Return shape (`{ userId, email }`) stays the same — caller code unchanged. |
| `/Users/xavierau/Code/js/whatsapp-crm/src/infrastructure/supabase/guards/platform-admin-guard.ts` | At lines 13–21, prefer reading `realm_access.roles` from the JWT for the `platform-admin` role. Keep the `platform_admins` table query as a belt-and-suspenders check until Phase 2. |
| `/Users/xavierau/Code/js/whatsapp-crm/src/infrastructure/supabase/guards/tenant-guard.ts` | No logic change at lines 15–45 — it already takes `session.userId` from `getAuthSession()`. The `userId` is now Keycloak's `sub` (same UUID as before, by design). |
| `/Users/xavierau/Code/js/whatsapp-crm/src/app/api/me/tenants/route.ts` | At lines 7–8, replace `supabase.auth.getUser()` with the new claims layer. The Postgres query at lines 17–21 stays identical — `user.id` is now the Keycloak `sub`. |
| **NEW** `/Users/xavierau/Code/js/whatsapp-crm/src/lib/auth/claims.ts` | Single source of truth for reading JWT claims. Every other file calls `getUserId()`, `getRoles()`, `getEmail()` from here. No raw JWT parsing anywhere else. |
| **NEW** `/Users/xavierau/Code/js/whatsapp-crm/src/lib/auth/pg-session.ts` | Helper that runs `SELECT set_config('app.user_id', $1, true)` on the active connection. Called from every server action / route handler before issuing tenant-scoped queries. |
| **CHANGE** `x-tenant-id` cookie set at `/Users/xavierau/Code/js/whatsapp-crm/src/app/login/page.tsx:77` | Replace with a signed cookie. Sign with HMAC over `(userId, tenantId)` using a secret from env. On every server-side read, verify the signature before trusting `tenantId`. |

### `/src/lib/auth/claims.ts` — shape

```ts
import { auth } from '@/lib/auth/next-auth-config'

export async function getUserId(): Promise<string> {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthenticated')
  return session.user.id // === Keycloak `sub` === original Supabase UUID
}

export async function getEmail(): Promise<string> {
  const session = await auth()
  return session?.user?.email ?? ''
}

export async function getRealmRoles(): Promise<string[]> {
  const session = await auth()
  // next-auth v5: roles propagated via the `jwt` callback into session.user
  // Verify against current next-auth v5 docs — the exact path depends on the
  // jwt/session callback implementation.
  return (session?.user as { realmRoles?: string[] })?.realmRoles ?? []
}

export async function isPlatformAdmin(): Promise<boolean> {
  return (await getRealmRoles()).includes('platform-admin')
}
```

The Auth.js Keycloak provider config must include the `jwt` callback that copies `realm_access.roles` from the Keycloak access token into the session — verify the exact API shape against current next-auth docs.

### `/src/lib/auth/pg-session.ts` — shape

```ts
import { createClient } from '@supabase/supabase-js'

const sb = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!, // bypasses anon RLS; we re-enforce via GUC
)

export async function withUserContext<T>(
  userId: string,
  fn: () => Promise<T>,
): Promise<T> {
  // Verify against current @supabase/supabase-js docs whether rpc() reuses
  // the same connection as subsequent queries. If not, run both inside an
  // explicit Postgres transaction via a SQL function.
  await sb.rpc('set_config', { name: 'app.user_id', value: userId, is_local: true })
  return fn()
}
```

> ⚠️ **Phase 2 (out of scope here):** the signed-cookie approach for tenant context is the **interim** fix. The proper fix is a `tenant_id` JWT claim populated by a Keycloak protocol mapper that calls the Tenant Service. That removes the cookie entirely and lets RLS read tenant from the JWT directly.

---

## Step 5: Cutover playbook

### T-7 days

- Ship Step 0 (RLS refactor) to prod. Verify no regression — tenant scoping still works exactly as before.
- Ship the claim-mapping layer (`/src/lib/auth/claims.ts`) and `withUserContext` helper, **wired only for the Supabase code path**. No behaviour change yet.
- Send first user-facing notice (zh-HK): "On <date> at <time> HKT, you'll be logged out and asked to sign in again. Your password and account stay the same."

### T-1 day

- Take a fresh `pg_dump` logical backup of the Supabase DB. Store off-platform.
- Confirm Keycloak prod cluster green (health endpoint, replica count, recent restart-free).
- Confirm Keycloak SMTP delivers a real email to a real inbox.
- Send second user-facing notice (24h reminder).
- Pre-run the Step 1 export script in dry-run against a Supabase read-replica; confirm output matches expected schema.

### T-0 (the maintenance window — target 30 min)

1. **Enable maintenance mode** — return 503 from app (feature flag or upstream LB rule). Confirm in browser.
2. **Run user export** (Step 1). Save artefacts off-host.
3. **Run transform** (Step 2) → produce batched JSON files.
4. **Run partial import** (Step 3). Confirm user count.
5. **Spot-check** one known user via direct grant (then disable direct grants on the client).
6. **Flip env** `AUTH_PROVIDER=keycloak` and trigger app restart / new deployment.
7. **Smoke test** with a real test account: login → tenant picker → dashboard loads → one tenant-scoped query returns expected row.
8. **Disable maintenance mode**. Stopwatch starts on user-visible recovery.

### T+1h

- Watch login success rate dashboard. Expected: ≥ 99% of attempts result in `200 /api/auth/callback`. Investigate any cluster of failures.
- Watch error logs for `Unauthorized`, `Tenant not found`, JWT validation errors.
- Watch Postgres for any RLS denials that look like real users blocked from their own data.

### T+24h

- Send "all clear" notice if metrics are healthy.
- Begin removing the `AUTH_PROVIDER=supabase` code path in a follow-up PR (do **not** delete in the cutover PR — keep the rollback option warm for at least a week).

---

## Step 6: Validation tests

Run all of these in staging against a Keycloak-imported test user before cutover, and again in prod immediately after the maintenance window.

| # | Test | Pass criteria |
|---|------|---------------|
| 1 | Existing user logs in with old password | 200, redirected to `/dashboard` or tenant picker |
| 2 | Tenant picker shows correct tenants | List matches `user_tenants` rows for that `user_id` |
| 3 | RLS still scopes data correctly | User A logged in cannot SELECT user B's tenant data; explicit attempt returns empty result, not error |
| 4 | Cross-tenant access denied | User with two tenants, `x-tenant-id` set to tenant 1 — query for tenant 2 data returns empty |
| 5 | Platform admin has elevated access | Admin with `platform-admin` realm role passes `assertPlatformAdmin()` at `/Users/xavierau/Code/js/whatsapp-crm/src/infrastructure/supabase/guards/platform-admin-guard.ts:9` |
| 6 | Password reset works via Keycloak email | "Forgot password" → email received → reset → log in with new password |
| 7 | Logout clears session | Click logout → cookie cleared, navigating to `/dashboard` redirects to login |
| 8 | Access token expires after 15 min | Per realm config at `/Users/xavierau/Code/keycloak-local/realm-export/fnb-platform-realm.json:23` — refresh token silently obtains new access token without UX disruption |
| 9 | Brute-force protection | 5 failed logins in 60s → user locked per `failureFactor: 5` at `/Users/xavierau/Code/keycloak-local/realm-export/fnb-platform-realm.json:21` |
| 10 | `x-tenant-id` cookie now signed | Tampering with the cookie value via DevTools → server rejects, redirects to tenant picker |

---

## Rollback plan

If the cutover fails at any point during the maintenance window or in the first hour after, roll back:

1. Re-enable maintenance mode (503).
2. Flip env var: `AUTH_PROVIDER=supabase`. Restart / redeploy.
3. Disable maintenance mode.
4. Supabase user data is **untouched** — Step 1 was a read-only export, no `DELETE` ran. Users sign back in via the original Supabase flow with their existing passwords.
5. Keycloak side: leave the imported users in place (harmless), or run a cleanup script that deletes users whose `attributes.supabase_legacy_id` matches the export — recoverable on next attempt.
6. Run a post-mortem. Fix the root cause. Schedule the next maintenance window only after the failure mode is reproduced and fixed in staging.

The rollback is testable: in staging, deliberately mis-configure (e.g., wrong client secret, wrong realm name) and verify the rollback returns the system to a working Supabase login within 5 minutes.

---

## Known limitations / gotchas

- **Social login users (Google/GitHub via Supabase) must re-authorise on first login.** Keycloak does not have their refresh tokens or provider account links. Communicate this in user comms. Plan: enable Keycloak Identity Brokering for the relevant providers; on first login the user clicks "Continue with Google", Keycloak brokers the OAuth flow, and Keycloak links the brokered identity to the imported user record (matched on email).
- **MFA enrolments do not transfer.** TOTP secrets and WebAuthn credentials are not in the Supabase export and have no equivalent in Keycloak's import format. Per the audit, `whatsapp-crm` does not currently use MFA — but if MFA is added before cutover, plan an enrolment-reset comms to affected users.
- **Audit log discontinuity.** Supabase auth events (sign-in, sign-out, password reset) stop being recorded in Supabase at cutover; Keycloak events start. For compliance, export the Supabase auth audit log to cold storage **before** cutover. Document the cutover timestamp so future audits can stitch the two log streams together.
- **Email deliverability gap.** Keycloak SMTP must be tested before cutover with a real send to a real inbox. Default Keycloak install has no SMTP and silently drops mail.
- **The `x-tenant-id` cookie.** Flagged in the security audit as a plain cookie that a malicious client can rewrite. Step 4 swaps it to a signed cookie — that is the **minimum**. Phase 2 (tenant claim in JWT) is the proper fix.
- **Connection-pool GUC pitfall.** `set_config(..., true)` is transaction-local. If the data path runs the GUC-set and the SELECT in two separate connections (PgBouncer transaction-mode pooling, for example), the SELECT sees `NULL` and RLS denies. Test the data path in staging with the same pooler configuration as prod.
- **Same UUID, different issuer.** `auth.users.id` (Supabase) and Keycloak `sub` carry the same UUID by design — that's why FK references keep working — but any code that hard-coded the JWT issuer (`https://<project>.supabase.co/auth/v1`) for validation will reject Keycloak tokens. Audit for hard-coded issuers before cutover.

---

## Time estimate

| Step | Estimate |
|------|----------|
| Step 0 (RLS refactor) | 1–3 days if not done already, 0 if pre-done |
| Steps 1–4 (export + transform + import + code) | 3–5 days |
| Step 5 (cutover) | 30 min window + 1 day prep |
| Step 6 (validation) | 1 day |
| **Total** | **1–2 weeks of focused work** |

---

## Phase 2 follow-ups (out of scope for THIS migration)

> ⚠️ **Phase 2 (out of scope here):** Move `restaurants`, `user_tenants`, `platform_admins` out of the `whatsapp-crm` Supabase Postgres into a dedicated **Tenant & Entitlement Service** with its own database. The migration above intentionally keeps these tables in place to limit blast radius.

> ⚠️ **Phase 2 (out of scope here):** Add `tenant_id` and `tenant_role` JWT claims via a Keycloak protocol mapper that calls the Tenant Service. This eliminates the `x-tenant-id` cookie entirely and lets RLS read tenant context directly from the JWT.

> ⚠️ **Phase 2 (out of scope here):** Replace the signed `x-tenant-id` cookie with the JWT claim above.

> ⚠️ **Phase 2 (out of scope here):** Configure Keycloak Identity Brokering for Google and GitHub. This becomes the replacement for Supabase social login. Until then, social-login users must reset their password to keep using the app.

> ⚠️ **Phase 2 (out of scope here):** Decommission Supabase Auth project (or downgrade its plan). Keep the Postgres-only project active for data; either remove the GoTrue add-on or revoke its connection from the app.
