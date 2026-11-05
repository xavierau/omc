# Testing Strategy

## Overview

This document defines the testing strategy for the WhatsApp CRM loyalty platform. The test suite follows the project's Clean Architecture layers, prioritizing domain and application logic where business rules live. Infrastructure and UI layers are tested selectively based on complexity and risk.

## Testing Pyramid

```
        ┌─────────┐
        │  E2E /  │  ← Future: critical user journeys
        │  API    │
       ┌┴─────────┴┐
       │ Application│  ← Use case tests (mocked infra)
       │  Use Cases │
      ┌┴────────────┴┐
      │   Domain      │  ← Pure logic, no I/O
      │   (Entities,  │
      │  Value Objects)│
      └───────────────┘
```

**Current focus**: Domain + Application layers (unit tests with mocked infrastructure).

## Coverage Targets

| Metric | Threshold | Current |
|--------|-----------|---------|
| Statements | 90% | 92.3% |
| Branches | 80% | 80.3% |
| Functions | 90% | 99.5% |
| Lines | 90% | 95.1% |

Thresholds are enforced in `vitest.config.ts` and will fail the test run if not met.

### What is measured

Coverage includes:
- `src/domain/**` — Entities, value objects, domain services
- `src/application/**` — All use case orchestrators
- Selected infrastructure: coupon mapper, guards, webhook parser, receipt mapper, validators, rate limiter, logger

### What is excluded from coverage

These are excluded because they require integration tests or are UI concerns:
- **API routes** (`src/app/api/`) — Thin HTTP handlers, tested via integration/E2E
- **React components** (`src/components/`) — Tested via component/E2E tests
- **React hooks** (`src/hooks/`) — Client-side data fetching, tested via E2E
- **Middleware** (`src/middleware.ts`) — Auth/routing, tested via integration
- **External clients** (Supabase client, Kapso template client, Gemini, GCP, layout service) — Require live connections
- **Queue workers** (`src/infrastructure/queue/`) — Tested via integration
- **Realtime broadcast** (`src/lib/supabase-broadcast.ts`) — Browser-only Supabase channel
- **CSS utility** (`src/lib/utils.ts`) — Trivial `clsx` + `tailwind-merge` wrapper

## Test Organization

### Layer 1: Domain (Pure Logic)

Location: `src/domain/**/___tests__/`

No mocks, no I/O. Tests run against real logic.

| Area | File | What it tests |
|------|------|---------------|
| Value Objects | `phone-number.test.ts` | Normalization, validation, masking |
| Value Objects | `coupon-code.test.ts` | Generation charset, uniqueness, format validation |
| Value Objects | `template-vars.test.ts` | Template variable rendering |
| Entities | `coupon.test.ts` | `isSharedCoupon`, `isCouponRedeemable` (7 branch combos) |
| Entities | `whatsapp-template.test.ts` | `isTemplateSendable`, `extractParameters`, `validateTemplateName` |
| Services | `receipt-validation.test.ts` | Tamper divergence threshold, merchant matching (exact, substring, CJK, Jaccard) |
| Services | `trial-status.test.ts` | Trial expiry, tenant accessibility |

### Layer 2: Application Use Cases (Mocked Infrastructure)

Location: `src/application/__tests__/`

All infrastructure dependencies are mocked via `vi.mock()`. Domain logic is used directly (not mocked) to catch regressions in business rules.

#### Coupon Lifecycle
- `redeem-coupon.test.ts` — Shared vs personal paths, duplicate rollback, expiry/inactive/max-uses guards
- `merchant-redeem-coupon.test.ts` — Restaurant ownership, member assignment, shared/personal flows
- `create-coupon.test.ts` — Code validation, discount guards, uppercase normalization
- `update-coupon.test.ts` — Not found, validation, partial updates
- `get-coupon-by-code.test.ts` — Expired/redeemed status resolution
- `get-coupon-detail.test.ts` — Redemption count aggregation
- `list-coupons.test.ts` — Pagination passthrough

#### Member Registration
- `register-member.test.ts` — WhatsApp: existing welcome-back, new onboarding (coupon + QR + events), QR failure resilience
- `register-member-web.test.ts` — Web: welcome coupon vs campaign coupon, invalid phone

#### Campaign Execution
- `execute-campaign.test.ts` — Welcome rejection, status transition, batch sending (25+ members), unsubscribed filtering, failure rollback, WhatsApp template sending, template not found/not approved
- `resolve-campaign-members.test.ts` — Selected/all/winback/birthday audience types

#### Points and Receipts
- `award-points.test.ts` — Points calculation, receipt confirmation, balance update, dual event logging
- `process-receipt.test.ts` — FlowForge submission, confidence branching, manual confirmation, layout verification fire-and-forget
- `validate-receipt.test.ts` — Tamper detection, duplicate receipt, merchant mismatch
- `verify-receipt-layout.test.ts` — No template skip, pass/fail flagging
- `build-receipt-template.test.ts` — Image count validation, archive + build flow

#### Rewards
- `redeem-reward.test.ts` — Not found/inactive, insufficient points, coupon creation with retry

#### WhatsApp Templates
- `create-whatsapp-template.test.ts` — Name validation, duplicate check, Meta submission, WABA auto-resolve
- `update-whatsapp-template.test.ts` — Draft reset, old Meta delete + resubmit
- `delete-whatsapp-template.test.ts` — With/without Meta cleanup
- `send-template-message.test.ts` — Unapproved rejection, param extraction, URL button substitution
- `sync-template-status.test.ts` — Status change detection
- `list-whatsapp-templates.test.ts` — Default pagination

#### Tenant Management
- `create-tenant.test.ts` — Slug uniqueness, admin user creation
- `get-tenant-detail.test.ts` — Email resolution, metrics aggregation
- `get-dashboard-overview.test.ts` — Aggregated metrics, empty state
- `get-platform-overview.test.ts` — Cross-tenant aggregation

#### QR Generation
- `generate-qr.test.ts` — Deep link format, QR options
- `generate-web-qr.test.ts` — With/without campaign, env var handling

### Layer 3: Infrastructure (Selected)

Location: `src/infrastructure/**/___tests__/`

| Area | File | What it tests |
|------|------|---------------|
| Mappers | `coupon-mapper.test.ts` | snake_case → camelCase, null handling, discount types |
| Mappers | `receipt-mapper.test.ts` | FlowForge response mapping |
| Mappers | `whatsapp-template-mapper.test.ts` | Template row mapping |
| Guards | `auth-guard.test.ts`, `tenant-guard.test.ts`, `platform-admin-guard.test.ts` | Auth and access control |
| Parsers | `webhook-parser.test.ts` | Kapso + Meta formats, image/interactive/text types, HMAC signature verification |
| Validation | `validators.test.ts` | Email, slug, UUID, required field validation |
| Validation | `tenant-validators.test.ts` | Create/update tenant, add user validation |
| Rate Limit | `rate-limiter.test.ts` | Window-based limiting, key isolation, expiry |
| Logging | `logger.test.ts` | Phone masking, log file creation |

## Conventions

### Test file location
- Domain/infrastructure tests: `__tests__/` directory alongside source
- Application tests: `src/application/__tests__/`

### Test structure
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.mock() calls at top level (hoisted by vitest)
vi.mock('@/infrastructure/supabase/repositories/coupon-repository', () => ({
  findCouponByCode: vi.fn(),
}))

// Import after mocks
import { myUseCase } from '@/application/my-use-case'
import { findCouponByCode } from '@/infrastructure/supabase/repositories/coupon-repository'

describe('myUseCase', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does something', async () => {
    vi.mocked(findCouponByCode).mockResolvedValue(someCoupon)
    const result = await myUseCase('code')
    expect(result.success).toBe(true)
  })
})
```

### Key rules
1. **Mock infrastructure, not domain.** Domain entities and value objects use real logic to catch regressions.
2. **Inline builders** with `Partial<T>` overrides for test data. Shared builders available in `src/test-utils/builders.ts`.
3. **Reset mocks in `beforeEach`** with `vi.clearAllMocks()` or `vi.resetAllMocks()`.
4. **One assertion focus per test.** Each `it()` tests one behavior.
5. **No explicit `globals: true`** — always import `describe`, `it`, `expect` from `vitest`.

## Commands

```bash
npm test              # Run all tests once
npm run test:watch    # Run in watch mode
npm run test:coverage # Run with coverage report + threshold enforcement
```

## Shared Test Utilities

Located in `src/test-utils/`:

- **`builders.ts`** — `buildCoupon()`, `buildCampaign()`, `buildMember()`, `buildRestaurant()`, `buildWhatsAppTemplate()`, `buildParsedReceipt()`, `buildCouponConfig()`
- **`mocks.ts`** — Factory functions for repository and client mocks: `mockCouponRepository()`, `mockEventRepository()`, `mockKapsoClient()`, etc.
- **`index.ts`** — Barrel export

## Future Work

- **API route tests**: Request/response validation for critical endpoints (redeem, webhook, join)
- **Integration tests**: Supabase repositories against a test database
- **E2E tests**: Critical user journeys (member registration → receipt → points → reward redemption)
- **Component tests**: Dashboard components with React Testing Library
- **CI pipeline**: Run `npm run test:coverage` in CI with threshold gates
