# WONB-008 Follow-ups

Items deferred during the WONB-008 code-review fix pass.

## Tenant-timezone-aware reconfirmation daily cap

**Where:** `src/infrastructure/supabase/repositories/reconfirmation-queries.ts:120` (the `todayStart()` helper used by `getReconfirmationSendsToday`).

**Limitation:** the daily 50/tenant/day reconfirmation send cap is anchored on the SERVER's local timezone. The cap is documented as per-tenant-per-day; HKT tenants on a UTC server see the counter roll over at 00:00 UTC (= 08:00 HKT) instead of midnight local time. In practice this matters at the boundary day — a few HKT-evening sends can spill into the "next" tenant day from the tenant's perspective.

**Why deferred:** threading `pacingConfig.tenantTimezone` through requires touching:
1. `reconfirmation-queries.ts` (signature change on `getReconfirmationSendsToday`).
2. `check-reconfirmation-eligibility.ts` (caller; needs to load tenant settings to get the TZ).
3. `campaign-settings-repository.ts` types/tests where the function is re-exported.
4. The resume route + create route + their tests.

That's >3 files, so per the WONB-008 review-fix policy ("if threading the TZ requires touching more than 3 files, prefer the comment+followup route") this was left as a tracked limitation.

**Acceptance for the follow-up:**
- `getReconfirmationSendsToday(restaurantId)` is replaced with `getReconfirmationSendsToday({ restaurantId, tenantTimezone })`.
- `todayStart` becomes a date-fns-tz / Luxon timezone-aware helper that returns the start-of-day in the tenant TZ as an ISO string.
- Existing tests are updated to pass `tenantTimezone: 'Asia/Hong_Kong'` and assert the boundary case (a 23:30 HKT send on day N is counted on day N, not day N+1 UTC).
