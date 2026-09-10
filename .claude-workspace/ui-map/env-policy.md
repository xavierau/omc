# Environment Policy

## prod

- **Allowed writes**: TODO — name the pinned test account's own tenant/org, and confirm no
  writes are allowed outside it.
- **Never**: send/execute campaigns that target real members; approve/reject/submit template
  reviews for real tenants; create/delete campaigns or members on real tenants.
- **Token fast-path (login-recipes.md recipe B)**: never on staging/prod — real-UI login only.

## staging / dev

- **dev**: writes allowed only inside the test tenant `00000000-0000-4000-a000-000000000001` as the
  throwaway user in `secrets.local.json` (created 2026-08-28 for WONB-018/019; delete at cleanup).
  Never touch the other three dev tenants' data. The dev DB lags prod by ~30 migrations, so a
  DB-backed step failing is an environment gap to report, not a product defect — confirm against
  unit tests before filing.
- **dev, 2026-09-10 (INT-001/WI-12)**: a second throwaway tenant-admin user was minted —
  `ui-test-int001@example.com`, role `admin` on the same test tenant, `secrets.local.json`
  `dev.users.tenantAdmin`. Not deleted (same "leave for follow-up verification" pattern as the
  WONB-018/019 user); delete both once all INT-001 UI verification is complete. Note:
  `secrets.local.json` does not survive this worktree being removed — re-mint per the pattern in
  `scripts/seed-platform-admin.ts` / `src/application/create-tenant.ts`'s `createUserTenant` call
  if a fresh worktree needs it again.
- **staging**: none exists for this project.
