# Referrer/Partner Commission System

**Date**: 2026-04-12
**Status**: Draft
**Scope**: Medium (new aggregate, multi-entity, integration with existing billing)

---

## 1. Business Context

Partners (referrers) bring tenants onto the platform. Each tenant has at most one referrer. At month-end, an admin generates a commission report showing how many broadcast messages each referred tenant sent, and calculates the referrer's earnings at a configurable per-message rate. Payouts are manual and report-driven.

---

## 2. Domain Model

### 2.1 Referrer Entity

```typescript
// src/domain/entities/referrer.ts

export type ReferrerStatus = 'active' | 'inactive'

export interface Referrer {
  id: string
  name: string
  contactEmail: string
  contactPhone: string | null
  commissionPerMessageHkd: number // e.g. 0.05
  status: ReferrerStatus
  createdAt: string
  updatedAt: string
}
```

**Design notes:**
- Follows the same plain-interface pattern used by `Campaign`, `Coupon`, `Restaurant`.
- `commissionPerMessageHkd` is stored in HKD to avoid currency conversion (the platform operates in HK).
- No behavior methods needed yet (YAGNI). Add domain functions when invariants emerge.

### 2.2 Commission Value Object

```typescript
// src/domain/value-objects/commission-rate.ts

export function isValidCommissionRate(rate: number): boolean {
  return rate >= 0 && rate <= 1 // HKD per message, max $1/msg
}
```

### 2.3 Referrer Commission Record

```typescript
// src/domain/entities/referrer-commission.ts

export type CommissionStatus = 'pending' | 'paid'

export interface ReferrerCommission {
  id: string
  referrerId: string
  month: string               // 'YYYY-MM'
  tenantId: string
  tenantName: string           // denormalized for reporting
  messagesSent: number
  commissionPerMessage: number // snapshot at generation time
  totalCommission: number      // messagesSent * commissionPerMessage
  status: CommissionStatus
  paidAt: string | null
  createdAt: string
}
```

**Invariant**: `totalCommission = messagesSent * commissionPerMessage` (enforced at creation).

### 2.4 Tenant-Referrer Link

Add `referrerId` to the existing `Restaurant` entity:

```typescript
// Updated src/domain/entities/restaurant.ts

export interface Restaurant {
  id: string
  name: string
  slug: string
  whatsappNumber: string
  kapsoPhoneNumberId: string | null
  metaBusinessAccountId: string | null
  status: TenantStatus
  plan: TenantPlan
  trialExpiresAt: string | null
  referrerId: string | null        // <-- NEW
  createdAt: string
}
```

### 2.5 Domain Relationships

```
Referrer (1) ----< (N) Restaurant
Referrer (1) ----< (N) ReferrerCommission
Restaurant (1) ----< (N) ReferrerCommission
```

- One referrer can have many tenants.
- One referrer has many commission records (one per tenant per month).
- A tenant has at most one referrer (nullable FK).

---

## 3. Database Schema

### 3.1 Migration: `018_referrer_commission.sql`

```sql
-- ============================================================
-- 018_referrer_commission.sql
-- Referrer/partner commission system
-- ============================================================

-- 1. Referrers table
CREATE TABLE referrers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  contact_phone TEXT,
  commission_per_message_hkd NUMERIC(10,4) NOT NULL DEFAULT 0.05,
  status      VARCHAR(10) NOT NULL DEFAULT 'active',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_referrer_status CHECK (status IN ('active', 'inactive')),
  CONSTRAINT chk_commission_rate CHECK (
    commission_per_message_hkd >= 0 AND commission_per_message_hkd <= 1
  )
);

-- 2. Link tenants to referrers
ALTER TABLE restaurants
  ADD COLUMN referrer_id UUID REFERENCES referrers(id);

CREATE INDEX idx_restaurants_referrer_id ON restaurants(referrer_id);

-- 3. Monthly commission settlement records
CREATE TABLE referrer_commissions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id           UUID NOT NULL REFERENCES referrers(id),
  month                 VARCHAR(7) NOT NULL,  -- 'YYYY-MM'
  tenant_id             UUID NOT NULL REFERENCES restaurants(id),
  tenant_name           TEXT NOT NULL,
  messages_sent         INTEGER NOT NULL DEFAULT 0,
  commission_per_message NUMERIC(10,4) NOT NULL,
  total_commission      NUMERIC(12,4) NOT NULL,
  status                VARCHAR(10) NOT NULL DEFAULT 'pending',
  paid_at               TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_commission_status CHECK (status IN ('pending', 'paid')),
  CONSTRAINT uq_referrer_month_tenant UNIQUE (referrer_id, month, tenant_id)
);

CREATE INDEX idx_referrer_commissions_month ON referrer_commissions(month);
CREATE INDEX idx_referrer_commissions_referrer ON referrer_commissions(referrer_id);

-- 4. RLS policies (platform admin only)
ALTER TABLE referrers ENABLE ROW LEVEL SECURITY;
ALTER TABLE referrer_commissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY referrers_admin_all ON referrers
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM platform_admins
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY referrer_commissions_admin_all ON referrer_commissions
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM platform_admins
      WHERE user_id = auth.uid()
    )
  );

-- 5. Auto-update updated_at on referrers
CREATE OR REPLACE FUNCTION update_referrer_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_referrer_updated_at
  BEFORE UPDATE ON referrers
  FOR EACH ROW
  EXECUTE FUNCTION update_referrer_updated_at();
```

### 3.2 Key Schema Decisions

| Decision | Rationale |
|----------|-----------|
| `NUMERIC(10,4)` for commission rate | Precision for sub-cent amounts (HK$0.05) |
| `UNIQUE(referrer_id, month, tenant_id)` | Prevents duplicate commission records; enables upsert on re-generation |
| Nullable `referrer_id` on restaurants | Existing tenants have no referrer; no data migration needed |
| `tenant_name` denormalized | Report readability; snapshot at generation time |
| `commission_per_message` on commission record | Snapshot of rate at generation time; decoupled from future rate changes |

---

## 4. Application Use Cases

All use cases follow the existing pattern: exported async functions, no classes, direct Supabase client calls in repositories.

### 4.1 create-referrer

```typescript
// src/application/create-referrer.ts

interface CreateReferrerInput {
  name: string
  contactEmail: string
  contactPhone?: string
  commissionPerMessageHkd?: number // defaults to 0.05
}

interface CreateReferrerResult {
  id: string
}

export async function createReferrer(
  input: CreateReferrerInput
): Promise<CreateReferrerResult>
```

**Validation**: name required, email format, commission rate 0-1.

### 4.2 update-referrer

```typescript
// src/application/update-referrer.ts

interface UpdateReferrerInput {
  name?: string
  contactEmail?: string
  contactPhone?: string | null
  commissionPerMessageHkd?: number
  status?: ReferrerStatus
}

export async function updateReferrer(
  id: string,
  input: UpdateReferrerInput
): Promise<void>
```

**Edge case**: If status changes to `inactive`, no new commission records are generated for this referrer in future report runs. Existing unpaid records remain.

### 4.3 list-referrers

```typescript
// src/application/list-referrers.ts

interface ReferrerListItem {
  id: string
  name: string
  contactEmail: string
  status: ReferrerStatus
  commissionPerMessageHkd: number
  tenantCount: number
  totalEarningsHkd: number  // sum of all commission records
  unpaidEarningsHkd: number // sum of pending records
}

export async function listReferrers(): Promise<ReferrerListItem[]>
```

### 4.4 get-referrer-detail

```typescript
// src/application/get-referrer-detail.ts

interface ReferrerDetail {
  referrer: Referrer
  tenants: Array<{ id: string; name: string; plan: string; status: string }>
  commissions: ReferrerCommission[] // ordered by month desc
  totalEarningsHkd: number
  unpaidEarningsHkd: number
}

export async function getReferrerDetail(
  id: string
): Promise<ReferrerDetail>
```

### 4.5 assign-referrer-to-tenant

```typescript
// src/application/assign-referrer-to-tenant.ts

export async function assignReferrerToTenant(
  tenantId: string,
  referrerId: string | null  // null = remove referrer
): Promise<void>
```

**Validation**: Referrer must exist and be active (if not null). Tenant must exist.

### 4.6 generate-referrer-report

This is the core use case. It integrates with the existing `getAllTenantsUsageForMonth` from `campaign-usage-repository.ts`.

```typescript
// src/application/generate-referrer-report.ts

interface ReferrerReportRow {
  referrerId: string
  referrerName: string
  tenantId: string
  tenantName: string
  messagesSent: number
  commissionPerMessage: number
  totalCommission: number
}

interface ReferrerReport {
  month: string
  rows: ReferrerReportRow[]
  totalCommissionHkd: number
  referrerSummaries: Array<{
    referrerId: string
    referrerName: string
    tenantCount: number
    totalMessages: number
    totalCommissionHkd: number
  }>
}

export async function generateReferrerReport(
  month?: string
): Promise<ReferrerReport>
```

**Algorithm:**

1. Determine target month (default: current month).
2. Fetch all tenants with a non-null `referrer_id` (join restaurants + referrers where referrer status = 'active').
3. Call existing `getAllTenantsUsageForMonth(monthStart, monthEnd)` to get message counts per tenant.
4. For each referred tenant with messages > 0:
   - Look up the referrer's current `commission_per_message_hkd`.
   - Calculate `total = messages * rate`.
   - Upsert into `referrer_commissions` (using the unique constraint on `referrer_id, month, tenant_id`).
5. Return the report for display/CSV export.

**Integration with existing code:**
- Reuses `getAllTenantsUsageForMonth` from `campaign-usage-repository.ts` (no duplication).
- Follows the same `currentMonth()` / `parseMonthRange()` pattern from `get-billing-report.ts`. Extract shared month utility to avoid DRY violation (third use).

### 4.7 mark-commission-paid

```typescript
// src/application/mark-commission-paid.ts

export async function markCommissionPaid(
  referrerId: string,
  month: string
): Promise<{ updatedCount: number }>
```

**Behavior**: Updates all `referrer_commissions` rows matching `(referrer_id, month)` from `pending` to `paid`, setting `paid_at = now()`.

---

## 5. Infrastructure Layer

### 5.1 Referrer Repository

```typescript
// src/infrastructure/supabase/repositories/referrer-repository.ts

// Functions:
export async function insertReferrer(input: CreateReferrerInput): Promise<{ id: string }>
export async function updateReferrerRow(id: string, input: UpdateInput): Promise<void>
export async function findReferrerById(id: string): Promise<ReferrerRow | null>
export async function listAllReferrers(): Promise<ReferrerRow[]>
export async function listReferrersWithStats(): Promise<ReferrerListItemRow[]>
```

### 5.2 Referrer Commission Repository

```typescript
// src/infrastructure/supabase/repositories/referrer-commission-repository.ts

// Functions:
export async function upsertCommissionRecord(record: UpsertInput): Promise<void>
export async function listCommissionsByReferrer(referrerId: string): Promise<CommissionRow[]>
export async function listCommissionsByMonth(month: string): Promise<CommissionRow[]>
export async function markMonthPaid(referrerId: string, month: string): Promise<number>
export async function getReferrerEarnings(referrerId: string): Promise<{ total: number; unpaid: number }>
```

### 5.3 Restaurant Repository Update

Add to `restaurant-admin-repository.ts`:

```typescript
export async function updateReferrer(
  tenantId: string,
  referrerId: string | null
): Promise<void>

export async function listTenantsByReferrer(
  referrerId: string
): Promise<TenantSummary[]>
```

Update `RestaurantRow` interface to include `referrer_id: string | null`.

### 5.4 Shared Month Utility (DRY extraction)

Both `get-billing-report.ts` and `get-campaign-usage.ts` duplicate `currentMonth()` and `parseMonthRange()`. With a third consumer (`generate-referrer-report`), extract to:

```typescript
// src/domain/services/month-range.ts

export function currentMonth(): string
export function parseMonthRange(month: string): { monthStart: string; monthEnd: string }
```

---

## 6. API Endpoints

All under `/api/admin/referrers/` following the existing admin API pattern (`assertPlatformAdmin`, `checkAdminRateLimit`, audit logging).

| Method | Path | Use Case | Notes |
|--------|------|----------|-------|
| `GET` | `/api/admin/referrers` | `listReferrers` | Returns list with summary stats |
| `POST` | `/api/admin/referrers` | `createReferrer` | Body: `{ name, contactEmail, contactPhone?, commissionPerMessageHkd? }` |
| `GET` | `/api/admin/referrers/[id]` | `getReferrerDetail` | Includes tenants + commission history |
| `PUT` | `/api/admin/referrers/[id]` | `updateReferrer` | Partial update |
| `GET` | `/api/admin/referrers/report` | `generateReferrerReport` | Query: `?month=YYYY-MM` |
| `GET` | `/api/admin/referrers/report/csv` | `generateReferrerReport` + CSV | Returns `text/csv` with `Content-Disposition` header |
| `POST` | `/api/admin/referrers/[id]/mark-paid` | `markCommissionPaid` | Body: `{ month: "YYYY-MM" }` |
| `PUT` | `/api/admin/tenants/[id]/referrer` | `assignReferrerToTenant` | Body: `{ referrerId: string | null }` |

### 6.1 File Structure

```
src/app/api/admin/referrers/
  route.ts                    # GET (list), POST (create)
  [id]/
    route.ts                  # GET (detail), PUT (update)
    mark-paid/
      route.ts                # POST
  report/
    route.ts                  # GET (JSON report)
    csv/
      route.ts                # GET (CSV download)

src/app/api/admin/tenants/[id]/referrer/
  route.ts                    # PUT (assign referrer)
```

### 6.2 CSV Export Format

```csv
Month,Referrer,Referrer Email,Tenant,Messages Sent,Rate (HKD),Commission (HKD),Status
2026-03,Alice Partners,alice@example.com,Restaurant A,1200,0.0500,60.0000,pending
2026-03,Alice Partners,alice@example.com,Restaurant B,800,0.0500,40.0000,pending
```

---

## 7. Admin UI Pages

### 7.1 Referrer List Page

**Route**: `/admin/(dashboard)/referrers/page.tsx`

- Table: Name, Email, Status (badge), Commission Rate, Tenant Count, Total Earnings, Unpaid Earnings
- Actions: "New Referrer" button, row click to detail
- No search/filter needed initially (small number of referrers)

### 7.2 Referrer Detail Page

**Route**: `/admin/(dashboard)/referrers/[id]/page.tsx`

- Header: Referrer name, status badge, edit button
- Edit form: name, email, phone, commission rate, status
- Section: "Assigned Tenants" table (name, plan, status)
- Section: "Commission History" table grouped by month (month, total messages, total commission, status, "Mark Paid" button)

### 7.3 Commission Report Page

**Route**: `/admin/(dashboard)/referrers/report/page.tsx`

- Month picker (defaults to current month)
- "Generate Report" button (calls the report endpoint, which upserts records)
- Summary cards: Total Referrers, Total Messages, Total Commission
- Table: Referrer, Tenant, Messages, Rate, Commission, Status
- "Export CSV" button
- "Mark All Paid" per referrer

### 7.4 Tenant Detail Page Update

**Route**: existing `/admin/(dashboard)/tenants/[id]/page.tsx`

- Add "Referrer" section with a dropdown selector (list of active referrers + "None" option)
- Calls `PUT /api/admin/tenants/[id]/referrer`

### 7.5 Sidebar Update

Add "Referrers" nav item to the admin sidebar (`src/components/dashboard/sidebar.tsx`), between "Billing" and "Audit Logs".

---

## 8. Integration Points

### 8.1 With `get-billing-report.ts`

No modification needed to the billing report. The referrer commission system is a parallel reporting concern. Both consume `getAllTenantsUsageForMonth` independently.

If in the future the billing report should show referrer costs as a line item, the billing report can import from referrer-commission-repository -- but this is not in scope now (YAGNI).

### 8.2 With `campaign-usage-repository.ts`

`generate-referrer-report` calls `getAllTenantsUsageForMonth(monthStart, monthEnd)` directly. No changes to the existing function are needed. The usage data (messages per tenant per month) is the same data that powers the billing report.

### 8.3 With `restaurant-admin-repository.ts`

- `RestaurantRow` interface gains `referrer_id: string | null`.
- `listAll` query adds `referrer_id` to its select list.
- `findById` query adds `referrer_id` to its select list.
- New function: `updateReferrer(tenantId, referrerId)`.
- New function: `listTenantsByReferrer(referrerId)`.

---

## 9. Edge Cases

| Scenario | Behavior |
|----------|----------|
| Referrer deactivated | No commission records generated for new months. Existing unpaid records remain and can still be marked paid. |
| Commission rate changes mid-month | Rate is snapshotted when report is generated. If report is re-generated, it picks up the current rate and upserts (overwrites). |
| Tenant switches referrer mid-month | Takes effect immediately. Next report generation uses the current referrer. Previous month's records are unaffected. |
| Tenant has no referrer | No commission record generated for that tenant. |
| Report generated twice for same month | Upsert on `(referrer_id, month, tenant_id)`. Updates messages_sent and total_commission. Does NOT overwrite records already marked `paid`. |
| Referrer deleted | Not supported. Use status=inactive instead. FK constraints prevent deletion if commission records exist. |
| Zero messages in a month | No commission record generated (skip tenants with 0 messages). |

---

## 10. Task Breakdown

### Phase 1: Domain + Database (backend-dev)

| # | Task | Dependencies | TDD |
|---|------|-------------|-----|
| 1 | Create `commission-rate` value object | None | Test: valid/invalid rates |
| 2 | Create `referrer` entity interface | None | No test needed (plain interface) |
| 3 | Create `referrer-commission` entity interface | None | No test needed (plain interface) |
| 4 | Update `restaurant` entity to add `referrerId` | None | No test needed (interface change) |
| 5 | Extract `month-range` service from billing/usage | None | Test: currentMonth, parseMonthRange |
| 6 | Write migration `018_referrer_commission.sql` | None | Manual verification |

### Phase 2: Repositories (backend-dev)

| # | Task | Dependencies | TDD |
|---|------|-------------|-----|
| 7 | `referrer-repository.ts` | 1, 2, 6 | Test: CRUD operations (mapper tests) |
| 8 | `referrer-commission-repository.ts` | 3, 6 | Test: upsert, list, mark-paid, earnings |
| 9 | Update `restaurant-admin-repository.ts` | 4, 6 | Test: updateReferrer, listByReferrer |

### Phase 3: Use Cases (backend-dev)

| # | Task | Dependencies | TDD |
|---|------|-------------|-----|
| 10 | `create-referrer` use case | 7 | Test: happy path, validation errors |
| 11 | `update-referrer` use case | 7 | Test: partial update, rate change, deactivation |
| 12 | `list-referrers` use case | 7 | Test: returns stats |
| 13 | `get-referrer-detail` use case | 7, 8, 9 | Test: includes tenants + commissions |
| 14 | `assign-referrer-to-tenant` use case | 7, 9 | Test: assign, remove, invalid referrer |
| 15 | `generate-referrer-report` use case | 5, 7, 8, 9 | Test: calculation, upsert, skip-zero, skip-inactive |
| 16 | `mark-commission-paid` use case | 8 | Test: marks pending->paid, skips already-paid |
| 17 | Refactor `get-billing-report` and `get-campaign-usage` to use shared `month-range` | 5 | Test: existing tests still pass |

### Phase 4: API Routes (backend-dev)

| # | Task | Dependencies | TDD |
|---|------|-------------|-----|
| 18 | `POST/GET /api/admin/referrers` | 10, 12 | Test: auth guard, validation, response shape |
| 19 | `GET/PUT /api/admin/referrers/[id]` | 11, 13 | Test: not found, partial update |
| 20 | `GET /api/admin/referrers/report` | 15 | Test: month param, default month |
| 21 | `GET /api/admin/referrers/report/csv` | 15 | Test: CSV content-type, format |
| 22 | `POST /api/admin/referrers/[id]/mark-paid` | 16 | Test: month validation |
| 23 | `PUT /api/admin/tenants/[id]/referrer` | 14 | Test: assign, remove |

### Phase 5: Admin UI (frontend-dev)

| # | Task | Dependencies | TDD |
|---|------|-------------|-----|
| 24 | Referrer list page | 18 | Visual verification |
| 25 | Referrer detail page | 19, 22 | Visual verification |
| 26 | Commission report page with CSV export | 20, 21 | Visual verification |
| 27 | Tenant detail page: referrer dropdown | 23 | Visual verification |
| 28 | Sidebar: add "Referrers" nav item | None | Visual verification |

---

## 11. File Inventory (New Files)

```
supabase/migrations/018_referrer_commission.sql

src/domain/entities/referrer.ts
src/domain/entities/referrer-commission.ts
src/domain/value-objects/commission-rate.ts
src/domain/services/month-range.ts

src/application/create-referrer.ts
src/application/update-referrer.ts
src/application/list-referrers.ts
src/application/get-referrer-detail.ts
src/application/assign-referrer-to-tenant.ts
src/application/generate-referrer-report.ts
src/application/mark-commission-paid.ts

src/infrastructure/supabase/repositories/referrer-repository.ts
src/infrastructure/supabase/repositories/referrer-commission-repository.ts
src/infrastructure/validation/referrer-validators.ts

src/application/__tests__/create-referrer.test.ts
src/application/__tests__/update-referrer.test.ts
src/application/__tests__/list-referrers.test.ts
src/application/__tests__/get-referrer-detail.test.ts
src/application/__tests__/assign-referrer-to-tenant.test.ts
src/application/__tests__/generate-referrer-report.test.ts
src/application/__tests__/mark-commission-paid.test.ts
src/domain/value-objects/__tests__/commission-rate.test.ts
src/domain/services/__tests__/month-range.test.ts

src/app/api/admin/referrers/route.ts
src/app/api/admin/referrers/[id]/route.ts
src/app/api/admin/referrers/[id]/mark-paid/route.ts
src/app/api/admin/referrers/report/route.ts
src/app/api/admin/referrers/report/csv/route.ts
src/app/api/admin/tenants/[id]/referrer/route.ts

src/app/admin/(dashboard)/referrers/page.tsx
src/app/admin/(dashboard)/referrers/[id]/page.tsx
src/app/admin/(dashboard)/referrers/report/page.tsx
```

### Modified Files

```
src/domain/entities/restaurant.ts           # Add referrerId
src/infrastructure/supabase/repositories/restaurant-repository.ts   # Add referrer_id to RestaurantRow
src/infrastructure/supabase/repositories/restaurant-admin-repository.ts  # Add referrer functions + select
src/application/get-billing-report.ts       # Use shared month-range
src/application/get-campaign-usage.ts       # Use shared month-range
src/app/admin/(dashboard)/tenants/[id]/page.tsx  # Add referrer dropdown
src/components/dashboard/sidebar.tsx        # Add Referrers nav item
```

---

## 12. Validation Rules

```typescript
// src/infrastructure/validation/referrer-validators.ts

// createReferrer:
//   name: required, non-empty, max 100 chars
//   contactEmail: required, valid email format
//   contactPhone: optional, string
//   commissionPerMessageHkd: optional, number, 0 <= x <= 1

// updateReferrer:
//   All fields optional
//   Same constraints as above when provided
//   status: must be 'active' | 'inactive'

// assignReferrer:
//   referrerId: UUID format or null
```

---

## 13. Security Considerations

- All endpoints protected by `assertPlatformAdmin()` (existing guard).
- All endpoints rate-limited by `checkAdminRateLimit()` (existing middleware).
- Referrer CRUD actions logged via `logAdminAction()` (existing audit logger).
- RLS policies restrict both tables to platform admins only.
- No tenant-facing endpoints or UI (admin-only feature).
- Commission amounts validated at input boundary (0-1 HKD range).

---

## 14. Future Considerations (Not In Scope)

- **Partner dashboard**: If referrers need self-service access, add auth + portal. Currently admin-only.
- **Tiered commission**: Different rates per tier or volume. Currently flat rate per referrer.
- **Automatic payouts**: Integration with payment gateway. Currently manual.
- **Commission on non-campaign messages**: Currently only broadcast campaign messages count.
- **Historical rate tracking**: An audit trail of rate changes. Currently only latest rate + snapshot in commission record.
