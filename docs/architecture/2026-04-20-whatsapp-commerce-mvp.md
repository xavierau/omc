# Technical Design: WhatsApp Commerce MVP

**Status**: Draft — Ready for VP-Eng review
**Author**: Solution Architect
**Date**: 2026-04-20
**PRD**: [`docs/prd/whatsapp-commerce-mvp.md`](../prd/whatsapp-commerce-mvp.md) (v1.2, approved-draft)
**Sibling PRD**: [`docs/prd/multi-brand-loyalty-system.md`](../prd/multi-brand-loyalty-system.md)
**Target**: Phase 1 (10 weeks). Stripe-only. Port-first payment abstraction.

---

## 1. Executive Summary

OhMyClient is adding a commerce marketplace layer: restaurants sell vouchers through WhatsApp, diners pay via Stripe Connect Standard on the merchant's own connected account, and the platform collects an application fee at the gateway. This design translates PRD v1.2 into an additive extension of the existing clean-architecture codebase: one new aggregate (`Deal`), one new supporting aggregate (`PaymentIntent`), one new entity (`MerchantPaymentAccount`), and commerce columns on the existing `Coupon` aggregate. Every payment provider is isolated behind a `PaymentGatewayPort` to prevent Stripe-specific vocabulary from leaking into the domain. The MVP ships a `TestPaymentGatewayAdapter` alongside `StripeConnectAdapter` to prove the abstraction holds before PayMe/FPS arrive in Phase 2. The purchase flow mirrors `src/application/redeem-reward.ts`: a single orchestrating use case calls port-like helpers and emits events; POS redemption reuses `merchant-redeem-coupon.ts` verbatim with a single branching check for `type='purchased'`.

---

## 2. Scope & Non-Goals

### In scope (Phase 1)

- `deals` CRUD and lifecycle (`draft → scheduled → live → sold_out/ended/cancelled`)
- Inventory reservation with atomic Postgres functions
- `PaymentGatewayPort` (hexagonal contract) and two adapters: `StripeConnectAdapter`, `TestPaymentGatewayAdapter`
- Stripe Connect Standard merchant onboarding + `account.updated` webhook
- Purchase-intent API, `payment_intents` table, Stripe PaymentIntent creation on connected account with `application_fee_amount`
- Stripe webhook handler: signature verification, idempotent coupon issuance, points earning, WhatsApp utility delivery
- Refund flow (full refund with proportional application-fee refund)
- POS redemption of `type='purchased'` coupons (minimal branching in existing use case)
- `merchant_payment_accounts` status lifecycle, RLS policies
- Deal analytics (sold / remaining / GMV / fee / net)

### Explicitly deferred

- PayMe for Business, FPS, KPay, bbMSL adapters (Phase 2/3). Architected-for but unimplemented.
- Cross-brand deals (Phase 2)
- WhatsApp Catalog sync (Phase 1.5)
- Points-as-payment, gift vouchers, subscriptions (Phase 2/3)
- Partial refunds (Phase 2 — PRD only mandates full refund in MVP)
- Offline POS redemption tokens
- Automated FPS bank reconciliation
- Native WhatsApp Payments (await Meta HK rollout)

---

## 3. Domain Model

### 3.1 Aggregates & Entities

```
Deal (aggregate root)
├── invariants: max_supply > 0, sale_ends_at > sale_starts_at, fee bps in [0, 10000]
├── behaviour: publish(), cancel(), markSoldOut(), canReserve(qty)
└── references: restaurantId, optional groupId, optional vipSegmentId

PaymentIntent (aggregate root)
├── invariants: status transitions gated, amount >= 0, reservedUntil > createdAt
├── behaviour: markSucceeded(fee), markFailed(reason), markExpired(), markRefunded(amount, feeRefund)
└── references: dealId, memberId, providerCode, restaurantId (denormalized for RLS)

MerchantPaymentAccount (entity, not aggregate root)
├── invariants: unique(restaurant_id, provider), only one default per restaurant
├── behaviour: activate(capabilities), restrict(reason), disable()
└── lifecycle status: pending → active → restricted → disabled

Coupon (existing aggregate, extended)
├── new invariant: if type='purchased', (deal_id, payment_intent_id) required
└── new behaviours: markRefunded(), purchasedAt setter (via factory on webhook)
```

### 3.2 Entity Pseudocode

**Deal** — (new; mirrors `src/domain/entities/reward.ts` structure with lifecycle behaviour)

```typescript
// src/domain/entities/deal.ts
export type DealStatus = 'draft' | 'scheduled' | 'active' | 'sold_out' | 'ended' | 'cancelled'
export type DealDiscountKind = 'fixed_amount' | 'percentage' | 'item'

export interface Deal {
  id: string
  restaurantId: string
  groupId: string | null
  title: string
  description: string | null
  heroImageUrl: string | null
  purchasePrice: Money
  discount: DealDiscount                  // tagged union by kind
  inventory: InventoryCount               // value object
  saleWindow: { startsAt: string; endsAt: string }
  redemption: { expiresAt: string | null; validDays: number | null }
  validAtRestaurantIds: string[] | null   // null = owning only, [] = any in group
  vipSegmentId: string | null
  vipWindowHours: number
  pointsEarnRate: number                  // points per HKD
  applicationFeeBpsOverride: ApplicationFeeBps | null
  status: DealStatus
  createdBy: string
  createdAt: string
}

// Behaviours (pure functions so the aggregate stays a data shape — matches existing Coupon/Reward style)
export function canPublish(deal: Deal): boolean
export function canReserve(deal: Deal, qty: number, now: Date): boolean
export function remainingInventory(deal: Deal): number
export function effectiveStatus(deal: Deal, now: Date): DealStatus  // derives sold_out/ended from data
```

Rationale for matching existing data-shape-with-helper-functions style: the codebase's `Coupon` and `Reward` entities are shapes + helper functions (e.g. `isCouponRedeemable`). Introducing class-based aggregates here would break the prevailing convention for a single feature. Code reviewers will apply the same SOLID checklist regardless.

**PaymentIntent**

```typescript
// src/domain/entities/payment-intent.ts
export type PaymentIntentStatus =
  | 'pending' | 'succeeded' | 'failed' | 'expired' | 'refunded' | 'partially_refunded'

export interface PaymentIntent {
  id: string
  dealId: string
  memberId: string
  restaurantId: string              // denormalized for RLS + analytics
  amount: Money
  quantity: number
  providerCode: PaymentProviderCode
  providerIntentId: string | null   // nullable until adapter returns
  providerCheckoutUrl: string | null
  status: PaymentIntentStatus
  reservedUntil: string
  paidAt: string | null
  refundedAt: string | null
  refundReason: string | null
  platformFee: PlatformFeeSnapshot | null   // { amount: Money, refunded: Money }
  rawProviderPayload: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export function canTransition(from: PaymentIntentStatus, to: PaymentIntentStatus): boolean
export function isFinalState(status: PaymentIntentStatus): boolean
```

**MerchantPaymentAccount**

```typescript
// src/domain/entities/merchant-payment-account.ts
export type MerchantAccountStatus = 'pending' | 'active' | 'restricted' | 'disabled'

export interface MerchantPaymentAccount {
  id: string
  restaurantId: string
  providerCode: PaymentProviderCode
  providerAccountId: string | null   // Stripe acct_xxx, etc.
  status: MerchantAccountStatus
  onboardingUrl: string | null
  onboardingUrlExpiresAt: string | null
  capabilities: Record<string, boolean>
  applicationFeeBpsOverride: ApplicationFeeBps | null
  isDefault: boolean
  lastWebhookAt: string | null
  activatedAt: string | null
  createdAt: string
}

export function canLaunchDeals(account: MerchantPaymentAccount): boolean
export function needsOnboardingRefresh(account: MerchantPaymentAccount, now: Date): boolean
```

### 3.3 Value Objects

```typescript
// src/domain/value-objects/money.ts
// Immutable cents+currency primitive. All monetary math goes through here.
export class Money {
  private constructor(readonly amountCents: number, readonly currency: 'HKD') {}
  static of(cents: number, currency: 'HKD' = 'HKD'): Money
  add(other: Money): Money
  subtract(other: Money): Money
  multiplyBps(bps: number): Money           // for fee calculation, rounds half-up
  ratio(numerator: Money): number           // for proportional refund
  toMinorUnits(): number                    // cents
}

// src/domain/value-objects/inventory-count.ts
export class InventoryCount {
  private constructor(readonly max: number, readonly sold: number) {}
  static of(max: number, sold = 0): InventoryCount
  reserve(qty: number): InventoryCount       // throws if insufficient
  release(qty: number): InventoryCount
  isSoldOut(): boolean
  remaining(): number
}

// src/domain/value-objects/application-fee-bps.ts
export class ApplicationFeeBps {
  private constructor(readonly value: number) {}
  static of(bps: number): ApplicationFeeBps   // 0 <= bps <= 2000 (hard cap 20%)
  apply(amount: Money): Money                  // amount.multiplyBps(this.value)
}

// src/domain/value-objects/payment-provider-code.ts
export type PaymentProviderCode = 'stripe' | 'test' | 'payme' | 'fps' | 'kpay' | 'bbmsl'
export function isMvpSupported(code: PaymentProviderCode): boolean
```

### 3.4 Domain Invariants (enumerated — enforced in entities + DB checks)

| # | Invariant | Where enforced |
|---|-----------|---------------|
| I1 | `sale_ends_at > sale_starts_at` | DB CHECK + entity factory |
| I2 | `max_supply > 0`, `sold_count >= 0`, `sold_count <= max_supply` | DB CHECK + atomic SQL function |
| I3 | Exactly one of `discount_value_cents` / `discount_percentage` / `item_description` set per `discount_type` | DB CHECK |
| I4 | Exactly one of `redemption_expires_at` / `redemption_valid_days` set | DB CHECK |
| I5 | `application_fee_bps_override IN [0, 2000]` | VO constructor + DB CHECK |
| I6 | `coupon.type = 'purchased' ⇒ deal_id AND payment_intent_id NOT NULL` | DB CHECK |
| I7 | `payment_intent.status` transitions gated to `canTransition()` matrix | Entity + repo guard |
| I8 | `merchant_payment_accounts UNIQUE(restaurant_id, provider)` | DB unique constraint |
| I9 | Deal cannot be `launched` unless `MerchantPaymentAccount` for owning restaurant is `active` | Use case precondition |
| I10 | `platform_fee_amount.currency = amount.currency` | VO construction |

---

## 4. Port Contracts (Hexagonal)

### 4.1 `PaymentGatewayPort` — the single adapter contract

Location: `src/domain/ports/payment-gateway.ts`. The port is defined in the **domain** layer (unlike `pos-webhook.ts` which lives in `domain/ports/` — same convention). Domain and application layers depend only on this interface.

```typescript
// src/domain/ports/payment-gateway.ts

// ──────────────── Types the port trades in (all provider-agnostic) ────────────────

export interface OnboardingSession {
  readonly providerAccountId: string         // opaque to us; adapter interprets
  readonly onboardingUrl: string | null       // null if no hosted step (e.g., FPS manual)
  readonly onboardingUrlExpiresAt: string | null
  readonly status: 'pending' | 'active' | 'restricted'
  readonly capabilities: Record<string, boolean>
}

export interface MerchantStatusSnapshot {
  readonly providerAccountId: string
  readonly status: 'pending' | 'active' | 'restricted' | 'disabled'
  readonly capabilities: Record<string, boolean>
  readonly restrictionReason: string | null
  readonly observedAt: string
}

export interface CreatePaymentIntentParams {
  readonly merchantAccountId: string         // our internal MerchantPaymentAccount.id
  readonly merchantProviderAccountId: string // adapter-interpreted
  readonly amount: Money
  readonly applicationFee: Money             // computed upstream — never "bps"
  readonly successUrl: string
  readonly cancelUrl: string
  readonly idempotencyKey: string
  readonly metadata: Record<string, string>  // we put paymentIntentId, dealId, memberId
}

export interface PaymentIntentHandle {
  readonly providerIntentId: string
  readonly checkoutUrl: string | null
  readonly clientSecret: string | null       // for future in-chat flows
  readonly expiresAt: string | null
}

export interface RefundResult {
  readonly providerRefundId: string
  readonly refundedAmount: Money
  readonly applicationFeeRefunded: Money     // 0 if strategy is monthly_invoice
  readonly status: 'succeeded' | 'pending' | 'failed'
}

export type WebhookEventKind =
  | 'payment_succeeded'
  | 'payment_failed'
  | 'payment_expired'
  | 'refund_succeeded'
  | 'dispute_created'
  | 'merchant_account_updated'

export interface WebhookEvent {
  readonly kind: WebhookEventKind
  readonly providerEventId: string           // for idempotency
  readonly providerIntentId: string | null   // null for merchant events
  readonly providerAccountId: string | null  // null for platform events
  readonly payload: Record<string, unknown>
  readonly occurredAt: string
}

export type CommissionStrategy =
  | 'native_application_fee'
  | 'monthly_invoice'
  | 'revenue_share'

export class PaymentGatewayError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'provider_unavailable'
      | 'invalid_signature'
      | 'idempotency_conflict'
      | 'insufficient_capabilities'
      | 'merchant_account_restricted'
      | 'refund_not_allowed'
      | 'unknown',
    readonly providerErrorCode: string | null = null,
    readonly retryable = false,
  ) { super(message) }
}

// ──────────────── The single contract every adapter implements ────────────────

export interface PaymentGatewayPort {
  readonly code: PaymentProviderCode
  readonly commissionStrategy: CommissionStrategy

  // Merchant onboarding
  initiateMerchantOnboarding(params: {
    restaurantId: string
    returnUrl: string
    refreshUrl: string
  }): Promise<OnboardingSession>

  refreshOnboardingUrl(providerAccountId: string, params: {
    returnUrl: string
    refreshUrl: string
  }): Promise<OnboardingSession>

  checkMerchantStatus(providerAccountId: string): Promise<MerchantStatusSnapshot>

  // Payment lifecycle
  createPaymentIntent(params: CreatePaymentIntentParams): Promise<PaymentIntentHandle>
  refundPayment(params: {
    providerIntentId: string
    providerAccountId: string
    amount: Money
    refundApplicationFee: boolean
    reason: string
    idempotencyKey: string
  }): Promise<RefundResult>

  // Webhook ingress — adapter does signature verification + normalization
  parseWebhook(params: {
    rawBody: string
    signatureHeader: string | null
  }): WebhookEvent[]                         // throws PaymentGatewayError('invalid_signature')
}
```

**Port discipline — enforced in review**:
- No Stripe types (`Stripe.PaymentIntent`, `Stripe.Account`) in signatures
- No `applicationFeeAmountCents` — use `Money`
- No `stripeAccount` parameter — use `merchantProviderAccountId`
- `PaymentGatewayError.code` enum covers every failure mode any adapter needs to surface; adapters DO NOT throw raw provider errors

### 4.2 Repository Ports (thin — domain owns the interface, infrastructure implements)

Follows the existing repo convention in `src/infrastructure/supabase/repositories/*` (module-level functions, not class-based repos). Ports live as TypeScript types in `src/domain/ports/` for clarity.

```typescript
// src/domain/ports/deal-repository.ts
export interface DealRepository {
  nextId(): string
  save(deal: Deal): Promise<void>
  findById(id: string): Promise<Deal | null>
  findActiveByRestaurant(restaurantId: string): Promise<Deal[]>
  updateStatus(id: string, status: DealStatus): Promise<void>
  reserveInventory(id: string, quantity: number): Promise<{ newSoldCount: number }>
  releaseInventory(id: string, quantity: number): Promise<void>
}

// src/domain/ports/merchant-payment-account-repository.ts
export interface MerchantPaymentAccountRepository {
  findByRestaurantAndProvider(
    restaurantId: string,
    provider: PaymentProviderCode,
  ): Promise<MerchantPaymentAccount | null>
  findDefaultForRestaurant(restaurantId: string): Promise<MerchantPaymentAccount | null>
  findByProviderAccountId(provider: PaymentProviderCode, providerAccountId: string): Promise<MerchantPaymentAccount | null>
  save(account: MerchantPaymentAccount): Promise<void>
  updateStatus(id: string, status: MerchantAccountStatus, capabilities: Record<string, boolean>): Promise<void>
  updateOnboardingUrl(id: string, url: string, expiresAt: string): Promise<void>
}

// src/domain/ports/payment-intent-repository.ts
export interface PaymentIntentRepository {
  nextId(): string
  save(intent: PaymentIntent): Promise<void>
  findById(id: string): Promise<PaymentIntent | null>
  findByProviderIntentId(
    provider: PaymentProviderCode,
    providerIntentId: string,
  ): Promise<PaymentIntent | null>
  findExpired(now: Date, limit: number): Promise<PaymentIntent[]>
  transition(
    id: string,
    from: PaymentIntentStatus,
    to: PaymentIntentStatus,
    patch: Partial<PaymentIntent>,
  ): Promise<boolean>                        // false if status guard failed (concurrency)
}

// src/domain/ports/processed-webhook-store.ts (extends existing table)
export interface ProcessedWebhookStore {
  claim(idempotencyKey: string): Promise<boolean>   // true = first time, false = replay
}
```

### 4.3 Adapter Registry

```typescript
// src/application/payment-gateway-registry.ts
export interface PaymentGatewayRegistry {
  get(code: PaymentProviderCode): PaymentGatewayPort
}

// Composition root (infrastructure) picks concrete adapters:
// StripeConnectAdapter, TestPaymentGatewayAdapter (+ future PayMe/FPS/KPay/bbMSL)
```

This registry replaces the tempting but wrong shortcut of calling `new StripeConnectAdapter()` inside use cases. Use cases receive the registry, look up by `providerCode` from `MerchantPaymentAccount`.

---

## 5. Application Use Cases

Every use case is a **function** (matches `src/application/redeem-reward.ts` convention — not class-based). Dependencies injected as explicit parameters or via a thin `deps` object, not DI containers. TDD order: test file first, then implementation.

### 5.1 `create-deal.ts`

**Inputs**: `{ restaurantId, createdBy, title, description?, heroImageUrl?, purchasePriceCents, discountKind, discountValueCents?/discountPercentage?/itemDescription?, maxSupply, saleStartsAt, saleEndsAt, redemptionExpiresAt?/redemptionValidDays?, validAtRestaurantIds?, vipSegmentId?, vipWindowHours?, pointsEarnRate?, applicationFeeBpsOverride? }`

**Preconditions**:
- User is admin on `restaurantId` (enforced by route handler via existing `user_tenants` check)
- `maxSupply > 0`, `saleEndsAt > saleStartsAt` (entity factory)
- If `validAtRestaurantIds` non-null-non-empty, group's loyalty model ≠ `'separate'` (Phase 2 gating; for MVP reject any non-null input)
- Discount kind matches exactly one of the three value fields

**Output**: `{ dealId, status: 'draft' }`

**Side effects**:
- Insert `deals` row with `status='draft'`
- Emit `deal_created` event

**Errors**:
- `E_VALIDATION` — invariant violated (400)
- `E_FORBIDDEN` — not a restaurant admin (403, handled by route)

---

### 5.2 `publish-deal.ts`

Separate from create (PRD explicitly): lets merchant draft then launch. This is the I9 enforcement point.

**Inputs**: `{ dealId, actorUserId }`

**Preconditions**:
- Deal exists and `status IN ('draft', 'scheduled')`
- `MerchantPaymentAccount` for `deal.restaurantId` with `status='active'` exists (or per-deal override if we support that — we don't yet)
- Current time relative to `saleStartsAt` determines target status: `scheduled` if future, `active` if now

**Output**: `{ dealId, status: 'active' | 'scheduled', saleStartsAt, saleEndsAt }`

**Side effects**:
- `UPDATE deals SET status = ... WHERE id = ? AND status IN ('draft','scheduled')` (conditional to prevent races)
- Emit `deal_launched` event
- (Later listener) schedule BullMQ jobs: `deal_sale_end_sweep`, `deal_expiry_reminders`

**Errors**:
- `E_MERCHANT_NOT_READY` (409) — no active `MerchantPaymentAccount`
- `E_INVALID_STATE` (409) — deal already active/cancelled/ended

---

### 5.3 `purchase-deal.ts` — the core use case

Mirrors `src/application/redeem-reward.ts:16-43` almost line-for-line in shape: single entry point, delegates to helpers, returns tagged union.

**Inputs**: `{ dealId, phone, quantity?, restaurantId, preferredProvider?, idempotencyKey }`

**Preconditions**:
- Deal exists, `canReserve(deal, qty, now) === true`
- Member exists OR is auto-created from phone (with `source='commerce'`)
- VIP window: if `vipWindowHours > 0` and current time is in VIP pre-window, member must be in `vipSegmentId`
- Rate limit: max 3 purchase-intent attempts per (phone, dealId) per hour (middleware-enforced)
- `idempotencyKey` not already claimed for this (dealId, phone) pair → if replay, return prior intent

**Output**: `{ success: true, paymentIntentId, checkoutUrl, reservedUntil, amountCents } | { success: false, code: 'sold_out' | 'outside_window' | 'vip_only' | 'no_provider' | 'provider_error', message }`

**Side effects** (in this order — failure at any step triggers compensation):
1. Claim idempotency key in `purchase_intent_idempotency` table (prevents double-reserve on retries)
2. Resolve-or-create `member` by (`restaurantId`, `phone`)
3. Call `DealRepository.reserveInventory(dealId, qty)` — atomic SQL function `reserve_deal_inventory`
4. Compute application fee: `resolveFee(deal, merchantAccount, platformConfig)`
5. Insert `payment_intents` row with `status='pending'`, `reserved_until = NOW() + 10 minutes`, `quantity`, `amount`
6. Resolve `PaymentGatewayPort` for `merchantAccount.provider` via registry
7. Call `port.createPaymentIntent({ merchantProviderAccountId, amount, applicationFee, metadata: { paymentIntentId, dealId, memberId }, idempotencyKey })`
8. Update `payment_intents` with `provider_intent_id`, `provider_checkout_url`
9. Emit `deal_purchase_intent_created` event (logged, not customer-facing)
10. Return `{ paymentIntentId, checkoutUrl, reservedUntil, amountCents }`

**Compensation** (if step 7 fails):
- Release inventory via `DealRepository.releaseInventory(dealId, qty)`
- Mark `payment_intents.status='failed'`
- Return `{ success: false, code: 'provider_error' }`

**Errors**:
- `E_SOLD_OUT` (409) — `reserve_deal_inventory` raises
- `E_OUTSIDE_WINDOW` (400) — window check in SQL function
- `E_VIP_ONLY` (403)
- `E_NO_PROVIDER` (409) — no active `MerchantPaymentAccount`
- `E_PROVIDER` (502) — adapter threw; intent marked failed, inventory released

---

### 5.4 `handle-payment-success.ts`

Invoked by the Stripe webhook route after `parseWebhook` yields a `payment_succeeded` event.

**Inputs**: `{ webhookEvent: WebhookEvent, provider: PaymentProviderCode }`

**Preconditions**:
- `ProcessedWebhookStore.claim(providerEventId)` returns `true` (first delivery)
- `PaymentIntent` exists with matching `providerIntentId`
- Current status is `pending` (else idempotent no-op on replay)

**Output**: void (webhook responder returns 200)

**Side effects** (ordered, each guarded by idempotency):
1. `PaymentIntentRepository.transition(id, 'pending', 'succeeded', { paidAt, platformFee })` — returns false if already transitioned → exit
2. Issue `Coupon` via extended `createCoupon`:
   - `type='purchased'`, `deal_id`, `payment_intent_id`, `purchase_price_cents`, `currency`, `purchased_at`
   - Reuse code-generation loop from `redeem-reward.ts:65-86`
   - Expiry derived from `deal.redemption_expires_at` OR `purchased_at + deal.redemption_valid_days`
3. Award points via existing `adjustMemberPoints(memberId, purchasePrice.hkd * deal.pointsEarnRate)` — reuses `022_adjust_member_points.sql`
4. Emit `deal_purchased` event with `{ dealId, couponId, paymentIntentId, memberId, amountCents, provider }`
5. (Event listener, async) send WhatsApp `commerce_purchase_confirmation` utility template with coupon + QR
6. Check `deal.sold_count >= max_supply` → transition `deals.status='sold_out'` + emit `deal_sold_out`

**Errors**:
- `E_WEBHOOK_REPLAY` — swallowed, return 200 (Stripe stops retrying)
- `E_INTENT_NOT_FOUND` — log + 200 (Stripe shouldn't retry; operational alert)
- `E_COUPON_CREATION_FAILED` — **critical**. Do NOT automatically refund. Log + alert ops. Return 500 → Stripe retries. Webhook retries are the compensation mechanism.

---

### 5.5 `handle-payment-failure.ts`

**Inputs**: `{ webhookEvent: WebhookEvent, provider: PaymentProviderCode, reason: string }`

**Preconditions**: webhook claimed; intent found; status is `pending`

**Side effects**:
1. Transition intent to `failed` or `expired` based on webhook kind
2. `DealRepository.releaseInventory(intent.dealId, intent.quantity)` (atomic SQL)
3. If deal was `sold_out`, flip to `active` (handled inside `release_deal_inventory`)
4. Emit `deal_purchase_failed` event

**Errors**: all idempotent no-ops on replay.

---

### 5.6 `refund-purchase.ts`

Refund a fully-unredeemed coupon (partial refund is Phase 2).

**Inputs**: `{ couponId, actorUserId, reason, refundPurchasePoints: boolean }`

**Preconditions**:
- Actor is admin on `coupon.restaurantId` OR platform admin
- `coupon.type = 'purchased'`
- `coupon.status = 'active'` (not redeemed, not already refunded)
- Associated `PaymentIntent.status = 'succeeded'`

**Output**: `{ couponId, status: 'refunded', refundedAmountCents, platformFeeRefundedCents, providerRefundId, pointsReversed }`

**Side effects** (order matters — provider call first, local mutation after):
1. Load `coupon`, `paymentIntent`, `merchantPaymentAccount`
2. Resolve provider via registry
3. Call `port.refundPayment({ providerIntentId, providerAccountId, amount, refundApplicationFee: true, reason, idempotencyKey: couponId + 'refund' })`
4. On provider success: within a single DB transaction:
   - `coupon.status = 'refunded'`, `refunded_at = NOW()`
   - `payment_intent.status = 'refunded'`, update `platform_fee_refunded`
   - If `refundPurchasePoints`: `adjustMemberPoints(memberId, -purchasePrice * pointsEarnRate)`
   - If sale window still open: `release_deal_inventory(dealId, quantity)` (so the unit returns to sale)
5. Emit `coupon_refunded` event → listener sends `commerce_refund_confirmation` utility template

**Compensation**: if step 3 succeeds but step 4 fails mid-transaction, Postgres rolls back. **The provider refund is already committed** — operator must reconcile manually. Alert fires. This is acceptable because the diner already got their money back; the local state mismatch is recoverable.

**Errors**:
- `E_ALREADY_REDEEMED` (400) — block with "Cannot refund redeemed voucher"
- `E_ALREADY_REFUNDED` (400)
- `E_PROVIDER_REFUND_FAILED` (502) — adapter threw; coupon stays `active`; merchant sees error

---

### 5.7 `redeem-purchased-coupon.ts`

**This is the thin extension to existing `merchant-redeem-coupon.ts`, not a full new use case.** The PRD explicitly says reuse the existing flow. The only new logic is a branch on `coupon.type === 'purchased'`.

**Planned change to `src/application/merchant-redeem-coupon.ts`**:

```typescript
// around line 54 (after isCouponRedeemable check), add:
if (coupon.type === 'purchased') {
  // same as handlePersonalRedemption but:
  // 1. No points deduction (member already paid cash)
  // 2. Emit 'redeem' event with dataJson.couponType='purchased' so points listener
  //    awards purchase-based points (deal.pointsEarnRate * purchase_price) on POS txn
  // 3. Send 'commerce_redemption_confirmation' utility template post-redemption
  return handlePurchasedRedemption(coupon, restaurantId)
}
```

No new use case file. Any additional branching lives in a new helper `handlePurchasedRedemption()` inside `merchant-redeem-coupon.ts` (which is already under 150 lines, we have headroom).

**Errors**: same error codes as existing flow.

---

### 5.8 `onboard-merchant-stripe.ts`

**Inputs**: `{ restaurantId, actorUserId, returnUrl, refreshUrl }`

**Preconditions**:
- Actor is admin on restaurant
- No existing `MerchantPaymentAccount` for `(restaurantId, 'stripe')` OR existing one is `pending`/`restricted`

**Output**: `{ accountId, onboardingUrl, expiresAt }`

**Side effects**:
1. If no existing account: call `stripeAdapter.initiateMerchantOnboarding({ restaurantId, returnUrl, refreshUrl })` → adapter creates Stripe account and account link
2. `MerchantPaymentAccountRepository.save(...)` with `status='pending'`, `onboarding_url`, `onboarding_url_expires_at`
3. If existing account (pending): call `stripeAdapter.refreshOnboardingUrl(providerAccountId, { returnUrl, refreshUrl })` → update URL in place (PRD WC-09: Stripe links expire in 7 days; "Resume Setup" re-issues)

**Errors**:
- `E_ACCOUNT_ALREADY_ACTIVE` (409) — idempotent; return existing account
- `E_PROVIDER_UNAVAILABLE` (502)

---

### 5.9 `sync-merchant-account-status.ts`

Handles Stripe's `account.updated` webhook (platform-level, not connected-account-level).

**Inputs**: `{ webhookEvent: WebhookEvent }` where `kind='merchant_account_updated'`

**Preconditions**: webhook claimed

**Side effects**:
1. Parse `providerAccountId` from webhook payload
2. `MerchantPaymentAccountRepository.findByProviderAccountId('stripe', providerAccountId)` → must exist
3. Call `stripeAdapter.checkMerchantStatus(providerAccountId)` to fetch canonical state (do not trust webhook body alone)
4. Update `merchant_payment_accounts.status` + `capabilities` atomically
5. Emit internal `merchant_account_activated` event if transitioning to `active`

**Errors**: all idempotent.

---

## 6. Infrastructure Adapters

### 6.1 `StripeConnectAdapter`

Location: `src/infrastructure/payment/stripe-connect-adapter.ts`

Implements `PaymentGatewayPort`. Uses the official `stripe` npm package. Single `Stripe` client initialized with platform secret key. All connected-account calls use `{ stripeAccount: merchantProviderAccountId }` option.

```typescript
export class StripeConnectAdapter implements PaymentGatewayPort {
  readonly code = 'stripe' as const
  readonly commissionStrategy = 'native_application_fee' as const

  constructor(private readonly stripe: Stripe, private readonly webhookSecret: string) {}

  async initiateMerchantOnboarding(params): Promise<OnboardingSession> {
    const account = await this.stripe.accounts.create({
      type: 'standard', country: 'HK', email: /* merchant email */,
    })
    const link = await this.stripe.accountLinks.create({
      account: account.id,
      type: 'account_onboarding',
      return_url: params.returnUrl,
      refresh_url: params.refreshUrl,
    })
    return { providerAccountId: account.id, onboardingUrl: link.url, ... }
  }

  async createPaymentIntent(params): Promise<PaymentIntentHandle> {
    // Use Checkout Session (hosted) — one less integration than Elements.
    const session = await this.stripe.checkout.sessions.create({
      mode: 'payment',
      payment_intent_data: {
        application_fee_amount: params.applicationFee.amountCents,
        metadata: params.metadata,
      },
      line_items: [{ /* from params */ }],
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
    }, {
      idempotencyKey: params.idempotencyKey,
      stripeAccount: params.merchantProviderAccountId,
    })
    return {
      providerIntentId: session.payment_intent as string,
      checkoutUrl: session.url,
      clientSecret: null,
      expiresAt: new Date(session.expires_at * 1000).toISOString(),
    }
  }

  async refundPayment(params): Promise<RefundResult> {
    const refund = await this.stripe.refunds.create({
      payment_intent: params.providerIntentId,
      amount: params.amount.amountCents,
      refund_application_fee: params.refundApplicationFee,
      reason: 'requested_by_customer',
      metadata: { reason: params.reason },
    }, {
      idempotencyKey: params.idempotencyKey,
      stripeAccount: params.providerAccountId,
    })
    return {
      providerRefundId: refund.id,
      refundedAmount: Money.of(refund.amount),
      applicationFeeRefunded: Money.of(refund.application_fee_amount ?? 0),
      status: refund.status === 'succeeded' ? 'succeeded' : 'pending',
    }
  }

  parseWebhook(params): WebhookEvent[] {
    const event = this.stripe.webhooks.constructEvent(
      params.rawBody, params.signatureHeader ?? '', this.webhookSecret,
    ) // throws if signature invalid → we rewrap as PaymentGatewayError
    return [normalizeStripeEvent(event)]
  }
}
```

**Stripe-specific secrets stay inside this file**: `application_fee_amount`, `stripeAccount`, `refund_application_fee`, `constructEvent`. Zero leakage to domain.

### 6.2 `TestPaymentGatewayAdapter`

Location: `src/infrastructure/payment/test-payment-gateway-adapter.ts`

Purpose: prove `PaymentGatewayPort` is not Stripe-coupled (per PRD R15). Used in tests and can be toggled via env flag for staging demos.

```typescript
export class TestPaymentGatewayAdapter implements PaymentGatewayPort {
  readonly code = 'test' as const
  readonly commissionStrategy = 'native_application_fee' as const
  private readonly memory = new Map<string, unknown>()

  async initiateMerchantOnboarding(params): Promise<OnboardingSession> {
    const id = `test_acct_${crypto.randomUUID()}`
    return { providerAccountId: id, onboardingUrl: `/test-onboard/${id}`, ... status: 'active' }
  }

  async createPaymentIntent(params): Promise<PaymentIntentHandle> {
    const id = `test_pi_${crypto.randomUUID()}`
    this.memory.set(id, params)
    return { providerIntentId: id, checkoutUrl: `/test-checkout/${id}`, clientSecret: null, expiresAt: null }
  }

  async refundPayment(params): Promise<RefundResult> { /* in-memory */ }

  parseWebhook(params): WebhookEvent[] {
    // Dev-only: signature = hmac(TEST_SECRET, body), matching the same check pattern
    // the Stripe adapter uses. Proves the port is symmetric.
    if (!verifyTestSignature(params.rawBody, params.signatureHeader)) {
      throw new PaymentGatewayError('invalid signature', 'invalid_signature')
    }
    return [JSON.parse(params.rawBody) as WebhookEvent]
  }
}
```

Contract tests (see §16) run the same suite against both adapters.

### 6.3 Supabase Repositories

Follow the existing convention: module-level functions, not classes. Each repository is <150 lines.

```typescript
// src/infrastructure/supabase/repositories/deal-repository.ts
export async function createDeal(params: CreateDealParams): Promise<Deal>
export async function findDealById(id: string): Promise<Deal | null>
export async function updateDealStatus(id: string, status: DealStatus): Promise<void>
export async function reserveInventory(id: string, qty: number): Promise<{ newSoldCount: number }>
  // calls RPC reserve_deal_inventory
export async function releaseInventory(id: string, qty: number): Promise<void>
  // calls RPC release_deal_inventory_for_intent (see §7 for signature)

// src/infrastructure/supabase/repositories/merchant-payment-account-repository.ts
// src/infrastructure/supabase/repositories/payment-intent-repository.ts
```

### 6.4 Stripe Webhook Route

Location: `src/app/api/webhooks/stripe/route.ts`

```typescript
import { headers } from 'next/headers'
import { stripeAdapter, handlePaymentSuccess, handlePaymentFailure, syncMerchantAccountStatus } from '@/composition'

export async function POST(req: Request) {
  const rawBody = await req.text()
  const signature = (await headers()).get('stripe-signature')

  let events: WebhookEvent[]
  try {
    events = stripeAdapter.parseWebhook({ rawBody, signatureHeader: signature })
  } catch (err) {
    if (err instanceof PaymentGatewayError && err.code === 'invalid_signature') {
      return new Response('invalid signature', { status: 400 })
    }
    throw err
  }

  for (const event of events) {
    switch (event.kind) {
      case 'payment_succeeded': await handlePaymentSuccess({ webhookEvent: event, provider: 'stripe' }); break
      case 'payment_failed':
      case 'payment_expired': await handlePaymentFailure({ webhookEvent: event, provider: 'stripe', reason: event.kind }); break
      case 'refund_succeeded': /* reconciliation — already handled in refund-purchase; log only */ break
      case 'dispute_created': /* emit coupon_refunded and auto-void — see §11 */ break
      case 'merchant_account_updated': await syncMerchantAccountStatus({ webhookEvent: event }); break
    }
  }
  return new Response('ok', { status: 200 })
}
```

---

## 7. Database Design

Three migrations, each independently shippable.

### 7.1 `supabase/migrations/025_commerce_deals.sql`

```sql
-- New lookup table (PRD Section 6.1)
CREATE TABLE payment_providers (
  code TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  onboarding_type TEXT NOT NULL
    CHECK (onboarding_type IN ('hosted_oauth','api_connect','manual_form','guided_external','test')),
  supports_split_payment BOOLEAN NOT NULL DEFAULT false,
  supports_webhook_reconciliation BOOLEAN NOT NULL DEFAULT false,
  commission_strategy TEXT NOT NULL
    CHECK (commission_strategy IN ('native_application_fee','monthly_invoice','revenue_share')),
  is_mvp_supported BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  config_schema JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO payment_providers
  (code, display_name, onboarding_type, supports_split_payment, supports_webhook_reconciliation, commission_strategy, is_mvp_supported)
VALUES
  ('stripe','Stripe','hosted_oauth',true,true,'native_application_fee',true),
  ('test','Test Gateway','test',true,true,'native_application_fee',true),
  ('payme','PayMe for Business','guided_external',false,false,'monthly_invoice',false),
  ('fps','FPS','manual_form',false,false,'monthly_invoice',false),
  ('kpay','KPay (Qfpay)','api_connect',false,true,'monthly_invoice',false),
  ('bbmsl','bbMSL (Global Payments)','api_connect',false,true,'monthly_invoice',false);

-- Deals (PRD 6.1)
CREATE TABLE deals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  group_id UUID REFERENCES restaurant_groups(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  hero_image_url TEXT,
  purchase_price_cents INTEGER NOT NULL CHECK (purchase_price_cents >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'HKD',
  discount_type TEXT NOT NULL CHECK (discount_type IN ('fixed_amount','percentage','item')),
  discount_value_cents INTEGER,
  discount_percentage NUMERIC(5,2),
  item_description TEXT,
  max_supply INTEGER NOT NULL CHECK (max_supply > 0),
  sold_count INTEGER NOT NULL DEFAULT 0 CHECK (sold_count >= 0),
  sale_starts_at TIMESTAMPTZ NOT NULL,
  sale_ends_at TIMESTAMPTZ NOT NULL,
  redemption_expires_at TIMESTAMPTZ,
  redemption_valid_days INTEGER,
  valid_at_restaurant_ids UUID[] DEFAULT NULL,
  vip_segment_id UUID REFERENCES member_segments(id) ON DELETE SET NULL,
  vip_window_hours INTEGER NOT NULL DEFAULT 0 CHECK (vip_window_hours >= 0),
  points_earn_rate NUMERIC(5,3) NOT NULL DEFAULT 0,
  application_fee_bps_override INTEGER CHECK (application_fee_bps_override BETWEEN 0 AND 2000),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','scheduled','active','sold_out','ended','cancelled')),
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (sale_ends_at > sale_starts_at),
  CHECK (sold_count <= max_supply),
  CHECK (
    (discount_type = 'fixed_amount' AND discount_value_cents IS NOT NULL) OR
    (discount_type = 'percentage' AND discount_percentage IS NOT NULL) OR
    (discount_type = 'item' AND item_description IS NOT NULL)
  ),
  CHECK (redemption_expires_at IS NOT NULL OR redemption_valid_days IS NOT NULL)
);
CREATE INDEX idx_deals_restaurant ON deals(restaurant_id);
CREATE INDEX idx_deals_group ON deals(group_id);
-- Active flash sales lookup (PRD-called-out performance index)
CREATE INDEX idx_deals_active_window ON deals(restaurant_id, sale_ends_at)
  WHERE status IN ('active','scheduled');
CREATE INDEX idx_deals_status_window ON deals(status, sale_starts_at, sale_ends_at);

-- Atomic reservation (PRD 6.3)
CREATE OR REPLACE FUNCTION reserve_deal_inventory(
  p_deal_id UUID, p_quantity INTEGER
) RETURNS TABLE (new_sold_count INTEGER) LANGUAGE plpgsql AS $$
DECLARE v_max INTEGER; v_sold INTEGER; v_starts TIMESTAMPTZ; v_ends TIMESTAMPTZ; v_status TEXT;
BEGIN
  SELECT max_supply, sold_count, sale_starts_at, sale_ends_at, status
    INTO v_max, v_sold, v_starts, v_ends, v_status
    FROM deals WHERE id = p_deal_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DEAL_NOT_FOUND'; END IF;
  IF v_status NOT IN ('active','scheduled') THEN RAISE EXCEPTION 'DEAL_NOT_PURCHASABLE: %', v_status; END IF;
  IF NOW() < v_starts OR NOW() > v_ends THEN RAISE EXCEPTION 'OUTSIDE_WINDOW'; END IF;
  IF v_sold + p_quantity > v_max THEN RAISE EXCEPTION 'SOLD_OUT: remaining=%, requested=%', v_max-v_sold, p_quantity; END IF;
  UPDATE deals
    SET sold_count = sold_count + p_quantity,
        status = CASE WHEN sold_count + p_quantity >= max_supply THEN 'sold_out' ELSE status END,
        updated_at = NOW()
    WHERE id = p_deal_id;
  RETURN QUERY SELECT v_sold + p_quantity;
END; $$;

-- Atomic release (used by refund + expired-reservation sweep)
CREATE OR REPLACE FUNCTION release_deal_inventory(
  p_deal_id UUID, p_quantity INTEGER
) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  UPDATE deals
    SET sold_count = GREATEST(sold_count - p_quantity, 0),
        status = CASE WHEN status = 'sold_out' AND sold_count - p_quantity < max_supply THEN 'active' ELSE status END,
        updated_at = NOW()
    WHERE id = p_deal_id;
END; $$;

-- RLS (mirrors 011_multi_tenant_platform_admin.sql conventions)
ALTER TABLE deals ENABLE ROW LEVEL SECURITY;
CREATE POLICY deals_select ON deals FOR SELECT
  USING (restaurant_id IN (SELECT user_restaurant_ids()) OR is_platform_admin());
CREATE POLICY deals_insert ON deals FOR INSERT
  WITH CHECK (restaurant_id IN (SELECT user_restaurant_ids()) OR is_platform_admin());
CREATE POLICY deals_update ON deals FOR UPDATE
  USING (restaurant_id IN (SELECT user_restaurant_ids()) OR is_platform_admin());
-- Service role (used by server actions) bypasses RLS already.

ALTER TABLE payment_providers ENABLE ROW LEVEL SECURITY;
CREATE POLICY pp_read_all ON payment_providers FOR SELECT USING (true);
```

### 7.2 `supabase/migrations/026_commerce_payment_providers.sql`

```sql
CREATE TABLE merchant_payment_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  provider TEXT NOT NULL REFERENCES payment_providers(code),
  provider_account_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','active','restricted','disabled')),
  onboarding_url TEXT,
  onboarding_url_expires_at TIMESTAMPTZ,
  capabilities JSONB NOT NULL DEFAULT '{}',
  application_fee_bps_override INTEGER CHECK (application_fee_bps_override BETWEEN 0 AND 2000),
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  last_webhook_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  activated_at TIMESTAMPTZ,
  UNIQUE (restaurant_id, provider)
);
CREATE INDEX idx_mpa_restaurant ON merchant_payment_accounts(restaurant_id);
CREATE INDEX idx_mpa_status ON merchant_payment_accounts(status);
-- At most one default per restaurant
CREATE UNIQUE INDEX idx_mpa_one_default_per_restaurant
  ON merchant_payment_accounts(restaurant_id) WHERE is_default = TRUE;

ALTER TABLE merchant_payment_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY mpa_select ON merchant_payment_accounts FOR SELECT
  USING (restaurant_id IN (SELECT user_restaurant_ids()) OR is_platform_admin());
CREATE POLICY mpa_insert ON merchant_payment_accounts FOR INSERT
  WITH CHECK (restaurant_id IN (SELECT user_restaurant_ids()) OR is_platform_admin());
CREATE POLICY mpa_update ON merchant_payment_accounts FOR UPDATE
  USING (restaurant_id IN (SELECT user_restaurant_ids()) OR is_platform_admin());
```

### 7.3 `supabase/migrations/027_commerce_payment_intents.sql`

```sql
CREATE TABLE payment_intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE RESTRICT,
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,  -- denorm for RLS
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'HKD',
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  provider TEXT NOT NULL REFERENCES payment_providers(code),
  provider_intent_id TEXT,
  provider_checkout_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','succeeded','failed','expired','refunded','partially_refunded')),
  reserved_until TIMESTAMPTZ NOT NULL,
  paid_at TIMESTAMPTZ,
  refunded_at TIMESTAMPTZ,
  refund_reason TEXT,
  platform_fee_amount INTEGER,
  platform_fee_currency CHAR(3),
  platform_fee_refunded INTEGER NOT NULL DEFAULT 0,
  raw_provider_payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((platform_fee_amount IS NULL) = (platform_fee_currency IS NULL))
);
CREATE INDEX idx_pi_deal ON payment_intents(deal_id);
CREATE INDEX idx_pi_member ON payment_intents(member_id);
CREATE INDEX idx_pi_restaurant ON payment_intents(restaurant_id);
CREATE INDEX idx_pi_status_expiry ON payment_intents(status, reserved_until);
CREATE UNIQUE INDEX idx_pi_provider_intent
  ON payment_intents(provider, provider_intent_id)
  WHERE provider_intent_id IS NOT NULL;

-- Idempotency for POST /api/commerce/purchase-intent
CREATE TABLE purchase_intent_idempotency (
  idempotency_key TEXT PRIMARY KEY,
  payment_intent_id UUID NOT NULL REFERENCES payment_intents(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Coupon commerce columns (PRD 6.2)
ALTER TABLE coupons ADD COLUMN deal_id UUID REFERENCES deals(id) ON DELETE SET NULL;
ALTER TABLE coupons ADD COLUMN payment_intent_id UUID REFERENCES payment_intents(id) ON DELETE SET NULL;
ALTER TABLE coupons ADD COLUMN purchase_price_cents INTEGER;
ALTER TABLE coupons ADD COLUMN currency CHAR(3);
ALTER TABLE coupons ADD COLUMN purchased_at TIMESTAMPTZ;
ALTER TABLE coupons ADD COLUMN refunded_at TIMESTAMPTZ;
ALTER TABLE coupons DROP CONSTRAINT IF EXISTS coupons_type_check;
ALTER TABLE coupons ADD CONSTRAINT coupons_type_check
  CHECK (type IN ('welcome','promo','reward','shared','campaign','manual','purchased'));
ALTER TABLE coupons DROP CONSTRAINT IF EXISTS coupons_status_check;
ALTER TABLE coupons ADD CONSTRAINT coupons_status_check
  CHECK (status IN ('active','redeemed','expired','voided','refunded','partially_refunded'));
-- I6: purchased coupons must have deal + payment intent
ALTER TABLE coupons ADD CONSTRAINT coupons_purchased_refs_check CHECK (
  type != 'purchased' OR (deal_id IS NOT NULL AND payment_intent_id IS NOT NULL)
);
CREATE INDEX idx_coupons_deal ON coupons(deal_id);
CREATE INDEX idx_coupons_payment_intent ON coupons(payment_intent_id);

-- Events: extend type CHECK (mirrors 020, 021, 023 pattern)
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_type_check;
ALTER TABLE events ADD CONSTRAINT events_type_check CHECK (type IN (
  'join','redeem','receipt','campaign','points','unsubscribe','reward_redeem',
  'pos_transaction','pos_refund','pos_customer_link','integration_error',
  'cross_brand_recognition','cross_brand_consent','points_transfer','group_campaign',
  'deal_created','deal_launched','deal_sold_out','deal_ended',
  'deal_purchased','deal_purchase_failed','deal_purchase_intent_created',
  'coupon_refunded','merchant_account_activated','payment_webhook'
));

-- Scheduled-sweep helper (BullMQ job calls this)
CREATE OR REPLACE FUNCTION release_expired_reservations() RETURNS INTEGER
LANGUAGE plpgsql AS $$
DECLARE v_count INTEGER := 0;
BEGIN
  WITH expired AS (
    UPDATE payment_intents
      SET status = 'expired', updated_at = NOW()
      WHERE status = 'pending' AND reserved_until < NOW()
      RETURNING id, deal_id, quantity
  )
  SELECT COUNT(*) INTO v_count FROM (
    SELECT release_deal_inventory(deal_id, quantity) FROM expired
  ) _;
  RETURN v_count;
END; $$;

-- RLS
ALTER TABLE payment_intents ENABLE ROW LEVEL SECURITY;
CREATE POLICY pi_select ON payment_intents FOR SELECT
  USING (restaurant_id IN (SELECT user_restaurant_ids()) OR is_platform_admin());
CREATE POLICY pi_insert ON payment_intents FOR INSERT
  WITH CHECK (restaurant_id IN (SELECT user_restaurant_ids()) OR is_platform_admin());
CREATE POLICY pi_update ON payment_intents FOR UPDATE
  USING (restaurant_id IN (SELECT user_restaurant_ids()) OR is_platform_admin());

ALTER TABLE purchase_intent_idempotency ENABLE ROW LEVEL SECURITY;
-- Service-role only; no user-facing policies
```

**Note**: `release_expired_reservations` in PRD 6.3 uses a CTE that tries to emit SQL per row via `release_deal_inventory`; Postgres does not allow calling a function that modifies rows inside a CTE like that. The design above uses a subquery select-from-function pattern. Backend-dev should verify this compiles on Supabase (Postgres 15) or split into two statements. If issues, fall back to a plpgsql FOR LOOP.

### 7.4 Indexes summary

| Index | Purpose |
|-------|---------|
| `idx_deals_active_window` (partial) | Main query: active deals per restaurant ordered by `sale_ends_at` |
| `idx_pi_status_expiry` | BullMQ sweep for expired reservations |
| `idx_pi_provider_intent` (unique partial) | Webhook idempotency + replay detection |
| `idx_coupons_deal` + `idx_coupons_payment_intent` | Analytics queries |
| `idx_mpa_one_default_per_restaurant` (unique partial) | Enforce "one default provider per restaurant" |

---

## 8. API Contracts

All merchant endpoints require `user_tenants` row for `(actor, restaurantId)`. All diner endpoints require phone number verification (existing magic-link flow via WhatsApp).

### 8.1 Merchant: Deal Management

#### `POST /api/dashboard/deals`

**Auth**: merchant JWT (Supabase session) + `user_tenants.role='admin'`

**Request**:
```typescript
{
  restaurantId: string
  title: string
  description?: string
  heroImageUrl?: string
  purchasePriceCents: number       // >= 0
  currency: 'HKD'                   // fixed MVP
  discountType: 'fixed_amount' | 'percentage' | 'item'
  discountValueCents?: number
  discountPercentage?: number       // 0-100
  itemDescription?: string
  maxSupply: number                 // > 0
  saleStartsAt: string              // ISO 8601
  saleEndsAt: string
  redemptionExpiresAt?: string
  redemptionValidDays?: number
  validAtRestaurantIds?: string[]   // MVP: reject non-null
  vipSegmentId?: string
  vipWindowHours?: number
  pointsEarnRate?: number           // default 0
}
```

**Response 201**:
```typescript
{ id: string, status: 'draft', createdAt: string }
```

**Errors**:
| Code | HTTP | Meaning |
|------|------|---------|
| `E_VALIDATION` | 400 | Invariant failure; `{ field, message }` detail |
| `E_CROSS_BRAND_NOT_SUPPORTED` | 400 | `validAtRestaurantIds` non-null in MVP |
| `E_FORBIDDEN` | 403 | Not a restaurant admin |
| `E_NOT_FOUND` | 404 | Restaurant doesn't exist |

#### `PATCH /api/dashboard/deals/[dealId]`

Restrictions on `active` deals: cannot reduce `max_supply < sold_count`, cannot move `sale_starts_at` past `sale_ends_at`, cannot change discount after sales exist.

#### `POST /api/dashboard/deals/[dealId]/publish`

**Auth**: merchant JWT, admin role. Endpoint name: `publish` (not `launch`) to match the use case name.

**Response 200**: `{ id, status: 'active' | 'scheduled', saleStartsAt, saleEndsAt }`

**Errors**:
| Code | HTTP | Meaning |
|------|------|---------|
| `E_MERCHANT_NOT_READY` | 409 | No active `MerchantPaymentAccount` |
| `E_INVALID_STATE` | 409 | Deal already `active`/`cancelled`/`ended` |

#### `POST /api/dashboard/deals/[dealId]/cancel`

**Response 200**: `{ id, status: 'cancelled' }`. Existing purchased coupons remain valid until their own expiry.

#### `GET /api/dashboard/deals/[dealId]/analytics`

**Response 200**:
```typescript
{
  dealId: string
  soldCount: number
  remainingInventory: number
  grossMerchandiseValueCents: number
  platformFeeCollectedCents: number
  netPayoutCents: number                     // GMV - fee - stripe processing (best-effort)
  redemptionCount: number
  redemptionRate: number
  outstandingLiabilityCents: number
  vipWindowSales: number
  publicWindowSales: number
  refundCount: number
  refundedAmountCents: number
  perHourSales: Array<{ hour: string, count: number }>
}
```

Max staleness: 5 seconds (PRD WC-03). Implementation: materialized view or direct aggregation against `payment_intents` + `coupon_redemptions`.

### 8.2 Diner: Purchase

#### `POST /api/commerce/purchase-intent`

**Auth**: customer phone token (short-lived JWT issued when diner taps the WhatsApp CTA; existing member session OR phone-number-only provisional token)

**Headers**: `Idempotency-Key: <uuid>` (required; 24-hour TTL)

**Request**:
```typescript
{
  dealId: string
  phone: string              // E.164
  quantity?: number          // default 1, max 5
  preferredProvider?: 'stripe' | 'test'   // MVP: usually omitted; resolved from merchant default
}
```

**Response 201**:
```typescript
{
  paymentIntentId: string
  checkoutUrl: string
  reservedUntil: string
  amountCents: number
  currency: 'HKD'
}
```

**Errors**:
| Code | HTTP | Meaning |
|------|------|---------|
| `E_SOLD_OUT` | 409 | Inventory exhausted |
| `E_OUTSIDE_WINDOW` | 400 | Sale not open / already ended |
| `E_VIP_ONLY` | 403 | VIP window, phone not in segment |
| `E_NO_PROVIDER` | 409 | Merchant has no active provider |
| `E_PROVIDER` | 502 | Adapter threw |
| `E_RATE_LIMITED` | 429 | >3 attempts per (phone, deal) / hour |
| `E_IDEMPOTENCY_CONFLICT` | 409 | Same key used with different body |

### 8.3 Webhook

#### `POST /api/webhooks/stripe`

**Auth**: HMAC signature (`stripe-signature` header) — verified by `StripeConnectAdapter.parseWebhook` using `STRIPE_WEBHOOK_SECRET` env var. Mirrors `024_require_webhook_secret.sql` philosophy for POS: signature required or 400.

**Idempotency**: provider event ID claimed in `processed_webhooks` table (existing table per 001). Replays return 200 immediately.

### 8.4 Refund

#### `POST /api/dashboard/coupons/[couponId]/refund`

**Auth**: merchant admin OR platform admin

**Request**: `{ reason: string, refundPurchasePoints: boolean }`

**Response 200**: see §5.6 output

**Errors**: per §5.6

### 8.5 Merchant Onboarding

#### `POST /api/dashboard/payments/stripe/connect`

**Request**: `{ restaurantId: string }`

**Response 201**: `{ accountId, onboardingUrl, expiresAt }`

#### `POST /api/dashboard/payments/stripe/resume`

Re-issues onboarding URL when expired.

---

## 9. Critical Sequence Diagrams

### 9.1 Flash Sale Purchase (happy path)

```
Diner (WhatsApp)    Next.js API    DealRepo    PaymentIntentRepo    StripeAdapter    Stripe    Webhook handler    WA provider
      │                 │            │              │                  │              │            │                   │
 tap Buy ──────────────▶│            │              │                  │              │            │                   │
      │  POST /api/commerce/purchase-intent         │                  │              │            │                   │
      │                 │────────reserve_deal_inventory(dealId,1)─────▶│              │            │                   │
      │                 │◀─ {newSoldCount}──────── │                  │              │            │                   │
      │                 │─save pending intent (FK deal+member)────────▶│              │            │                   │
      │                 │                                             │              │            │                   │
      │                 │─createPaymentIntent(amount, fee, idempKey)──▶│              │            │                   │
      │                 │                                             │─PI.create────▶│            │                   │
      │                 │                                             │◀─handle ─────│            │                   │
      │                 │◀─ {providerIntentId, checkoutUrl}───────────│              │            │                   │
      │                 │─update intent w/ provider_intent_id         │              │            │                   │
      │ ◀──{checkoutUrl}│                                             │              │            │                   │
      │                                                                              │            │                   │
 open Checkout ─────────────────────────────────────────────────────────────────────▶│            │                   │
 complete payment ──────────────────────────────────────────────────────────────────▶│            │                   │
      │                                                                              │──event────▶│                   │
      │                                                                              │            │─claim(evtId)      │
      │                                                                              │            │─transition pending→succeeded
      │                                                                              │            │─create coupon (purchased)
      │                                                                              │            │─award points (adjust_member_points)
      │                                                                              │            │─emit deal_purchased
      │                                                                              │            │─send commerce_purchase_confirmation─▶
      │◀─────────────────────────────────── utility template w/ coupon + QR ──────────────────────────────────────────│
```

### 9.2 Merchant Stripe Onboarding

```
Merchant   Dashboard UI   Next.js API   MerchantAcctRepo    StripeAdapter   Stripe
   │            │              │                │                 │            │
   │ click Connect Stripe      │                │                 │            │
   │────────────▶              │                │                 │            │
   │            │─POST /api/dashboard/payments/stripe/connect     │            │
   │            │              │                │                 │            │
   │            │              │─initiateMerchantOnboarding       │            │
   │            │              │────────────────────────────────▶│            │
   │            │              │                │                 │─accounts.create(type=standard,country=HK)▶
   │            │              │                │                 │◀──acct_xxx
   │            │              │                │                 │─accountLinks.create(refresh_url,return_url)▶
   │            │              │                │                 │◀──link.url
   │            │              │◀──{providerAccountId,onboardingUrl,expiresAt}
   │            │              │─save(status=pending)──▶           │            │
   │            │              │                │                 │            │
   │            │◀──{accountId, onboardingUrl}                    │            │
   │ redirect to Stripe hosted onboarding ───────────────────────▶│            │
   │            │              │                │                 │            │
   │ complete KYC ───────────────────────────────────────────────────────────────▶
   │            │              │                │                 │            │
   │                                                                    account.updated webhook
   │                                                                           ───▶ /api/webhooks/stripe
   │                                                                                 │─claim(evtId)
   │                                                                                 │─checkMerchantStatus
   │                                                                                 │─update status=active, capabilities
   │                                                                                 │─emit merchant_account_activated
   │ redirect back to dashboard, now shows "Connected"
```

### 9.3 Refund (with application fee refund)

```
Merchant   Dashboard   Next.js API   CouponRepo   PaymentIntentRepo   StripeAdapter   Stripe
   │          │            │              │               │                  │             │
   │ Refund   │            │              │               │                  │             │
   │─────────▶│─POST /api/dashboard/coupons/:id/refund──▶ │                  │             │
   │          │            │─load coupon,intent,account                      │             │
   │          │            │              │               │                  │             │
   │          │            │─refundPayment(providerIntentId,amount,refundApplicationFee=true)
   │          │            │──────────────────────────────────────────────▶│             │
   │          │            │                                                │─refunds.create(refund_application_fee=true, stripeAccount=acct)▶
   │          │            │                                                │◀─{id, amount, application_fee_amount}
   │          │            │◀──{providerRefundId,refundedAmount,feeRefunded}             │
   │          │            │─BEGIN TX                                                     │
   │          │            │─ coupon.status='refunded'                                    │
   │          │            │─ intent.status='refunded', platform_fee_refunded +=          │
   │          │            │─ if refundPurchasePoints: adjust_member_points(-delta)       │
   │          │            │─ if sale open: release_deal_inventory(qty)                   │
   │          │            │─COMMIT                                                       │
   │          │            │─emit coupon_refunded (→ refund_confirmation template)        │
   │          │◀─{refundedAmount, platformFeeRefunded, providerRefundId}
```

### 9.4 Inventory race — last unit, two diners

```
Diner A      Next.js API (request A)     Postgres     Next.js API (request B)      Diner B
  │                  │                        │                   │                      │
  │─POST intent─────▶│                        │                   │                      │
  │                  │─SELECT FOR UPDATE(deal)▶│                   │                      │
  │                  │                        │◀──row locked──    │                      │
  │                  │                        │                   │                      │
  │                                           │                   │◀── POST intent ──────│
  │                                           │◀──SELECT FOR UPDATE(deal) (blocks)      │
  │                  │─sold_count=max, status=sold_out            │                      │
  │                  │─COMMIT────────────────▶│                   │                      │
  │                  │                        │─── unblock B, reads NEW row ──▶          │
  │                                           │                   │ check: sold+1>max → RAISE SOLD_OUT
  │                  │◀──{checkoutUrl}        │                   │                      │
  │◀─{checkoutUrl}   │                        │                   │                      │
  │                                                               │◀──409 E_SOLD_OUT     │
  │                                                               │─────────────────────▶│
```

Serialization guarantee: `SELECT ... FOR UPDATE` on the `deals` row inside `reserve_deal_inventory` blocks concurrent writers. Postgres serializes at the row level; no extra `SERIALIZABLE` isolation required.

---

## 10. State Machines

### 10.1 `Deal.status`

```
  draft ───publish()───▶ scheduled ──sale_starts_at──▶ active ──sell_out──▶ sold_out ─┐
    │          │                                        │                             │
    │          │                                        └─sale_ends_at──▶ ended ──────┤
    │          │                                                                      │
    │          └─────────────────cancel()────────────────────┐                        │
    │                                                        ▼                        │
    └──────────────────────────────────────────────▶ cancelled                        │
                                                                                      ▼
                                                   [terminal for lifecycle; coupons live on]
```

Transitions:
- `draft → scheduled` iff `saleStartsAt > now`
- `draft → active` iff `saleStartsAt <= now < saleEndsAt`
- `scheduled → active` automatic by scheduled job when `saleStartsAt` arrives
- `active → sold_out` inside `reserve_deal_inventory` (same transaction)
- `active/scheduled → ended` by scheduled job when `saleEndsAt` arrives
- `draft/scheduled/active/sold_out → cancelled` by merchant action (no refunds triggered automatically)
- No transition back from `sold_out → active` by merchant action; only `release_deal_inventory` inside refund or expiry sweep

### 10.2 `Coupon.status` (extended)

Existing PRD implies two conceptual states on top of the current enum; here's the unified lifecycle for `type='purchased'`:

```
[no row]  ──payment_intent.succeeded──▶ active ──redeem()──▶ redeemed
                                           │
                                           ├─refund()───▶ refunded
                                           │
                                           ├─expires_at────▶ expired
                                           │
                                           └─chargeback()──▶ voided
```

- `reserved` and `pending_payment` mentioned in the brief are **conceptual states on the PaymentIntent**, not on the Coupon. Coupon rows are only created on `payment_succeeded`. This keeps the `Coupon` state machine simple and matches existing behaviour (coupons in the current system are always born `active`). See rejected alternative §19.

### 10.3 `MerchantPaymentAccount.status`

```
pending ──onboarding complete + capabilities enabled──▶ active
   │                                                      │
   │                                                      ├─restricted (Stripe: capabilities lost, payouts paused)
   │                                                      │        │
   │                                                      │        └──capabilities restored──▶ active
   │                                                      │
   │                                                      └─disabled (Stripe: rejected/closed)
   │                                                                │
   └──disabled (merchant abandoned) ──────────────────────────────── ┘
```

### 10.4 `PaymentIntent.status`

```
pending ──webhook: payment_succeeded──▶ succeeded ──refund──▶ refunded
   │                                        │
   │                                        └──partial_refund──▶ partially_refunded  [Phase 2]
   │
   ├──webhook: payment_failed───▶ failed
   └──reserved_until < NOW() (sweep job)──▶ expired
```

All transitions enforced via `PaymentIntentRepository.transition(id, from, to, patch)` which does a conditional `UPDATE ... WHERE id = ? AND status = ?` and returns `false` if the guard fails. This is the concurrency safety net.

---

## 11. Concurrency & Race Conditions

| # | Race | Solution |
|---|------|---------|
| C1 | Two diners buying the last unit simultaneously | `reserve_deal_inventory` uses `SELECT ... FOR UPDATE`; second caller blocks until first commits, then RAISEs `SOLD_OUT`. See §9.4. |
| C2 | Webhook delivered twice (Stripe retries) | `ProcessedWebhookStore.claim(providerEventId)` returns false on replay → handler no-ops. Plus `PaymentIntentRepository.transition()` refuses non-pending-to-succeeded moves. |
| C3 | Webhook `payment_succeeded` arrives after user-initiated refund already processed | `transition(id, 'pending', 'succeeded')` fails (status is already `refunded`); handler logs `stale_succeeded_webhook` and returns 200. No coupon created. |
| C4 | Refund vs redemption race: staff scans coupon at POS while merchant clicks Refund in dashboard | POS path uses existing `redeemCoupon(id)` which sets `status='redeemed'`; refund path requires `status='active'` at refund-entry load, but provider call can still race. Mitigation: refund use case does `SELECT coupon.status FROM coupons WHERE id = ? FOR UPDATE` **before** calling provider. If status changes to `redeemed` mid-refund, abort with `E_ALREADY_REDEEMED`. |
| C5 | Expired-reservation sweep job racing with webhook `payment_succeeded` | Same `transition` guard. If sweep flips to `expired` first, the webhook handler sees `expired` and no-ops. If webhook wins, sweep's `UPDATE ... WHERE status = 'pending'` affects 0 rows. |
| C6 | Merchant publishes deal twice (double-click) | `publish-deal` use case uses `UPDATE deals SET status = ? WHERE id = ? AND status IN ('draft','scheduled')`. Only one UPDATE affects a row. Second returns 0 rows → `E_INVALID_STATE`. |
| C7 | Two simultaneous onboarding clicks create two Stripe accounts | Client-side debounce + server-side check: `MerchantPaymentAccountRepository.findByRestaurantAndProvider` before `accounts.create`. If race still wins, manual cleanup via platform admin (Stripe accounts without transactions are fine to abandon). Rare; not worth transaction locking. |

---

## 12. Idempotency Strategy

### 12.1 End-to-end flow

| Surface | Mechanism | Storage |
|---------|-----------|--------|
| `POST /api/commerce/purchase-intent` | Client sends `Idempotency-Key` header (UUID) | `purchase_intent_idempotency(idempotency_key PRIMARY KEY, payment_intent_id)` |
| Stripe PaymentIntent creation | `idempotencyKey` passed to `stripe.checkout.sessions.create(..., { idempotencyKey })` — value = our `paymentIntent.id` | Stripe-side (24h) |
| Stripe refund | `idempotencyKey = couponId + ':refund'` | Stripe-side |
| Stripe webhook | Provider event id claimed via `ProcessedWebhookStore` | `processed_webhooks(idempotency_key)` (already exists from migration 001) |
| PaymentIntent status transitions | Conditional `UPDATE ... WHERE status = <expected>` returns row count | Inherent |

### 12.2 Replay contract

- Same idempotency key + same body → return previous result (200/201)
- Same idempotency key + different body → 409 `E_IDEMPOTENCY_CONFLICT`
- Missing idempotency key on `POST /api/commerce/purchase-intent` → 400

### 12.3 Idempotency key TTL

- `purchase_intent_idempotency`: 24 hours. Cleanup job nightly.
- `processed_webhooks`: 30 days (webhook replays beyond this window are treated as fresh — acceptable because the associated state transitions have been final for 30 days already).

---

## 13. Error Handling & Compensation

| Scenario | What happens | Compensation |
|----------|--------------|-------------|
| Inventory reserved but checkout session creation fails | `StripeConnectAdapter.createPaymentIntent` throws | `purchase-deal` catches, calls `releaseInventory`, marks intent `failed`, returns `E_PROVIDER`. Client can retry with new idempotency key. |
| Inventory reserved but diner abandons checkout | Intent stays `pending` until `reserved_until` | Scheduled job (`release_expired_reservations`) runs every 60s; flips intent to `expired`, releases inventory atomically |
| Payment succeeds but coupon creation fails | Webhook handler returns 500 | Stripe retries webhook for 3 days (native behaviour). Meanwhile ops gets alert from metrics (webhook-error-rate). Never auto-refund — money is in the merchant's Stripe balance, diner will be told to contact support. |
| WhatsApp delivery fails post-purchase | Event listener retries 3x with backoff (existing BullMQ pattern) | Fallback: diner can open a web receipt page `/receipts/[couponId]?token=<sig>` (Q5 open question) or reply "coupon" to the WA thread to re-trigger delivery. Listener marks delivery-failed event. |
| Refund provider call fails mid-transaction | Local rollback (coupon stays `active`) | Merchant retries from dashboard. No compensation needed — provider never charged. |
| Refund provider succeeds but local DB write fails | **Operational incident** | Alert ops. Manual reconciliation playbook: use Stripe dashboard refund as source of truth, manually set coupon/intent to `refunded`. Logged in incident journal. |
| Stripe `charge.dispute.created` (chargeback) | Auto-void coupon even if redeemed (rare, fraud edge) | Emit `coupon_refunded` with `reason='chargeback'`. Merchant sees in dashboard. Merchant disputes via Stripe UI. |
| Merchant onboarding abandoned mid-flow | `merchant_payment_accounts.status='pending'`, onboarding URL expires in 7 days | Dashboard shows "Resume Setup" button → calls `/api/dashboard/payments/stripe/resume` which re-issues the URL via `refreshOnboardingUrl` |

---

## 14. Observability

### 14.1 Metrics (emit via existing structured logger; ops dashboard consumes)

| Metric | Type | Labels | Alert |
|--------|------|--------|-------|
| `commerce.purchase_intent.created` | counter | `dealId, restaurantId, provider` | — |
| `commerce.purchase_intent.funnel` | histogram | `stage: intent_created\|checkout_opened\|paid\|coupon_delivered` | drop-off >40% at checkout→paid |
| `commerce.inventory.reservation_failed` | counter | `reason: sold_out\|outside_window\|vip_only` | sold_out rate >30% per deal in <5min (potential bot) |
| `commerce.webhook.stripe.received` | counter | `kind, status` | — |
| `commerce.webhook.stripe.processing_lag_ms` | histogram | `kind` | p95 >5000ms |
| `commerce.webhook.stripe.replay_rate` | ratio | — | >10% sustained (indicates handler slowness) |
| `commerce.coupon.issued` | counter | `dealId` | — |
| `commerce.coupon.delivery_failed` | counter | `channel=whatsapp` | >1% of issuances |
| `commerce.refund.processed` | counter | `reason` | — |
| `commerce.platform_fee.collected` | gauge | `restaurantId, currency` | — |
| `commerce.merchant.onboarding_abandoned_7d` | gauge | — | tracks PRD R6 |

### 14.2 Structured logs (match existing `[PosWebhook]` `[EventDispatch]` prefix convention)

- `[Commerce]` `purchase_intent.created`, `payment.succeeded`, `coupon.issued`, `refund.processed`
- `[StripeWebhook]` `received`, `replay`, `invalid_signature`, `handled`
- `[StripeAdapter]` `onboarding.created`, `payment_intent.created`, `refund.created`

### 14.3 Traces

Correlation ID per request. Thread through: HTTP → use case → adapter → webhook echo. Specifically link `paymentIntentId` across the purchase funnel for reconstruction.

---

## 15. Security

| Threat | Control |
|--------|---------|
| Webhook forgery | `StripeConnectAdapter.parseWebhook` calls `stripe.webhooks.constructEvent` with `STRIPE_WEBHOOK_SECRET`. Missing/invalid signature → 400. Mirrors migration `024_require_webhook_secret.sql` pattern. |
| Application fee tampering (client sends lower fee) | Fee computed **server-side only** inside `purchase-deal` use case. Client body has no fee field. |
| Refund authorization bypass | Route handler checks: actor is `admin` on `coupons.restaurant_id` via `user_tenants`, OR `is_platform_admin()`. Enforced at route layer + RLS. |
| IDOR on `GET /api/dashboard/deals/[dealId]` | RLS on `deals` restricts to `user_restaurant_ids()`. Even with service role, route handler re-checks. |
| Cross-tenant coupon redemption | `merchant-redeem-coupon.ts:39-42` already checks `coupon.restaurantId === restaurantId`. Keep the check when extending for `purchased` type. |
| Stolen idempotency key replay with altered body | Server stores body hash alongside key; mismatch → 409 |
| PII leakage in logs | Stripe event payloads stored in `payment_intents.raw_provider_payload`, not logs. Log `providerIntentId` only. |
| PCI scope creep | Never touch card data. Stripe Checkout hosted. `payment_intents` stores intent ID + amount only. |
| PDPO: marketing without consent | `members.consent_marketing` default `pending` for commerce-origin members. Only `utility` templates pre-consent (enforced by `whatsapp-templates.ts` port). |
| Rate limiting abuse | Middleware: 3 `/api/commerce/purchase-intent` per (phone, dealId) / hour. Burst triggers CAPTCHA (Phase 1.5). |
| Webhook endpoint DoS | Signature check is cheap; if invalid, 400 early. Rate limit at 100 req/s per IP (CDN layer). |
| Secrets management | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PLATFORM_ACCOUNT_ID` in env vars. No secrets in code. |

---

## 16. Testing Strategy

### 16.1 Layering (follow existing `src/**/__tests__/` convention; Vitest)

| Layer | What's tested | How |
|-------|---------------|------|
| Domain entities (`Deal`, `PaymentIntent`, `MerchantPaymentAccount`) | Invariants, state transitions, helper functions | Pure unit tests. No mocks. Pattern: `src/domain/entities/__tests__/coupon.test.ts` |
| Value objects (`Money`, `InventoryCount`, `ApplicationFeeBps`) | Constructor guards, arithmetic correctness, rounding | Pure unit tests |
| Use cases | Orchestration, error branches, event emission | Mocked repositories + mocked port. Pattern: `src/application/__tests__/redeem-reward.test.ts` — `vi.mock` per dependency; tagged-union result assertions |
| `PaymentGatewayPort` contract | Same behavioural tests run against both `StripeConnectAdapter` (via Stripe test mode) and `TestPaymentGatewayAdapter` | Shared `payment-gateway.contract.ts` suite imported by both adapter tests |
| Supabase repositories | CRUD + atomic SQL functions | Integration tests against local Supabase (`supabase start`) — existing pattern |
| API routes | Happy path + auth + idempotency | Request-response tests with mocked Supabase session |
| End-to-end | Single merchant onboarding + diner purchase + redemption | Playwright against dev env with Stripe test cards |

### 16.2 Critical test scenarios (non-exhaustive)

- Two concurrent `purchase-intent` calls for deal with `max_supply=1`: exactly one succeeds, other gets `E_SOLD_OUT`
- Webhook `payment_succeeded` delivered twice: coupon created once
- Webhook for expired intent: no coupon, no points
- Refund before payment: not possible (refund requires `coupon.status='active'`)
- Refund after redemption: blocked with `E_ALREADY_REDEEMED`
- Onboarding URL expired 7 days ago → `refreshOnboardingUrl` issues new one
- Merchant with `status='pending'` → `publish-deal` returns `E_MERCHANT_NOT_READY`
- `createDeal` with `validAtRestaurantIds=['abc']` in MVP → `E_CROSS_BRAND_NOT_SUPPORTED`
- Port abstraction leak detector: static test that greps `src/domain` and `src/application` for strings like `stripe_account`, `application_fee_amount`, `Stripe-Account`. Any hit fails CI.

### 16.3 Acceptance: PRD R15 (port-not-Stripe-coupled)

- Contract test suite passes identically against `StripeConnectAdapter` and `TestPaymentGatewayAdapter`
- Grep-based lint rule flags Stripe vocabulary outside `src/infrastructure/payment/stripe-*`
- Code review checklist item: "Does this file mention any provider by name? If yes, must be in `infrastructure/payment/<provider>-*`"

---

## 17. Phase 1 Implementation Sequence

Each PR is independently shippable (behind feature flag until end-to-end works).

| # | PR | Effort (dev-days) | Ships | Depends on |
|---|----|-------------------|-------|-----------|
| 1 | **Foundation**: migrations 025/026/027, domain entities, value objects, port interfaces, repo module skeletons, `TestPaymentGatewayAdapter` + contract test | 5 BE | Compiles, tests pass, zero user-visible change | — |
| 2 | **Deal CRUD**: `createDeal`, `updateDeal`, list/detail endpoints, admin dashboard page (draft only) | 3 BE + 4 FE | Merchant can draft deals; can't publish yet | PR1 |
| 3 | **Stripe Connect onboarding**: `StripeConnectAdapter` onboarding methods, `onboardMerchantStripe` use case, account.updated webhook, dashboard Settings > Payments page | 4 BE + 3 FE | Merchant can connect Stripe and see `active` status | PR1 |
| 4 | **Publish + purchase flow**: `publishDeal`, `purchaseDeal`, `StripeConnectAdapter.createPaymentIntent`, webhook `payment_succeeded` + `payment_failed` handlers, `processed_webhooks` integration, reservation sweep cron | 7 BE + 2 FE (public deal page) | Diner can buy via Stripe; coupon issued | PR1, PR3 |
| 5 | **WhatsApp delivery**: `commerce_purchase_confirmation` template registration, event listener for `deal_purchased`, QR generation (reuse `uploadCouponQr`), purchase points via `adjustMemberPoints` | 3 BE | Post-purchase utility template delivered within 60s | PR4 |
| 6 | **POS redemption**: extend `merchant-redeem-coupon.ts` with `type==='purchased'` branch + helper, redemption confirmation utility template | 2 BE | Diner can redeem via POS | PR5 |
| 7 | **Refund flow**: `refundPurchase` use case, `StripeConnectAdapter.refundPayment`, refund dashboard UI, refund confirmation template | 4 BE + 2 FE | Merchant can refund active coupons; fee refunded proportionally | PR4, PR5 |
| 8 | **Merchant dashboard**: deal analytics, platform fee visibility (Gross/Fee/Net), post-sale summary + Run Again, expiry reminder jobs (7d/1d) | 3 BE + 5 FE | Merchant sees live metrics + re-runs deals | PR4, PR7 |
| 9 | **Hardening + release**: platform admin commerce revenue dashboard, T&C auto-generation, observability polish, rate limiting, security review, e2e tests | 4 BE + 3 FE | MVP ready for pilot | all prior |

**Total**: ~35 backend-dev-days, ~19 frontend-dev-days.

At 1 senior BE + 1 senior FE working in parallel with normal meeting/review overhead (70% effective time):
- Backend: 35 / 0.7 ≈ 50 calendar-days ≈ **10 weeks**
- Frontend: 19 / 0.7 ≈ 27 calendar-days ≈ **~5.5 weeks** (frontend wraps earlier; FE picks up Phase 2 prep or QA in the remainder)

Matches PRD Section 16 target (10 weeks for Phase 1).

---

## 18. Open Technical Questions

Ordered by impact on MVP coding start:

1. **Deal publish vs `POST /deals/:id/launch` naming** (PRD Section 7 uses `launch`; use case name `publish-deal` is a judgement call). Resolution: align to whichever name FE UX copy uses. Suggest **`publish`** for domain clarity. PM/FE to confirm.
2. **Customer-facing web receipt page** (PRD Q5). If yes: `/receipts/[couponId]?token=<sig>` route needed. Signed URL with HMAC, no auth. Unblocks failed WA delivery fallback. Adds ~2 FE days.
3. **Auto-launch scheduler** (scheduled → active at `saleStartsAt`): BullMQ delayed job vs PostgreSQL `pg_cron` vs Next.js cron route. Recommend **BullMQ** for consistency with existing event-dispatch queue.
4. **Fee resolution precedence**: PRD says "deal override → merchant override → platform default." Where does platform default live? Env var, `system_config` table, or hard-coded constant? Recommend new `commerce_settings` row in existing platform config, default `300` bps pending PM rate-lock.
5. **Provisional member phone token**: how is a diner's phone verified before purchase for non-members? PRD says auto-create member on purchase. For MVP, accept phone from the WA-delivered CTA URL signed with HMAC (bind to member_phone). No OTP required for purchase-intent. Confirm acceptable with Security/Legal.
6. **Partial refund support in MVP**: PRD WC-04 and Section 11 mention partial refunds as future. Confirm MVP scope = full refund only (our assumption). The `partially_refunded` coupon status is reserved but unreachable in MVP code paths.
7. **Stripe email for `accounts.create`**: onboarding needs a merchant email. We don't currently store owner email. Use `restaurants.contact_email` (need to add?) or fetch from `user_tenants → auth.users`? Schema impact TBD.
8. **BullMQ workers for commerce**: new worker or reuse existing `event-dispatch-queue`? New queue recommended (`commerce-queue`) to isolate failures.
9. **`validAtRestaurantIds` column existence pre-Phase 2**: should migration 025 include the column (nullable, MVP rejects non-null) or defer to Phase 2 migration? Recommend **include now** to avoid schema churn.
10. **Platform admin commerce revenue dashboard**: scope for MVP? PRD WC-10 says yes. Included in PR9.

---

## 19. Rejected Alternatives

### 19.1 Extend `Coupon` entity with commerce fields vs create new `DealPurchase` entity

**Chosen**: extend `Coupon` with `deal_id`, `payment_intent_id`, `purchase_price_cents`, `currency`, `purchased_at`, `refunded_at` and add `type='purchased'`.

**Rejected**: separate `DealPurchase` entity that owns its own code.

**Rationale**: Reviewing `src/domain/entities/coupon.ts` and `merchant-redeem-coupon.ts`, the existing coupon type enum already grows (`welcome`, `promo`, `reward`, `shared`, `campaign`, `manual`). POS redemption already branches on type. A new `DealPurchase` would duplicate code-generation, expiry handling, redemption, and the coupon-redemptions ledger. The marginal cost of `type='purchased'` is one CHECK + one branch in `merchant-redeem-coupon.ts`. The existing `isCouponRedeemable` works unchanged. **The PRD Section 6.2 explicitly adopts this extension**. YAGNI: if commerce outgrows this model in Phase 2 (e.g., partial redemptions of face-value vouchers), we can extract then.

### 19.2 Port-first design vs direct Stripe SDK usage in use cases

**Chosen**: `PaymentGatewayPort` introduced BEFORE any adapter exists. `TestPaymentGatewayAdapter` validates the abstraction independently.

**Rejected**: "Use Stripe directly in MVP, abstract when PayMe arrives."

**Rationale**: PRD R15 rates this risk medium likelihood, medium+compounding impact. Retrofitting a port after Stripe calls have leaked into use cases is a rewrite, not a refactor. The cost of the port is ~200 lines of TypeScript interfaces + one test adapter; the cost of retrofitting later is 2-4 weeks of re-plumbing + regression risk. Every existing port in `src/domain/ports/` (e.g., `pos-webhook.ts`, `whatsapp-messaging.ts`) follows this discipline — so should this.

### 19.3 Reserve-as-coupon-row vs reserve-as-payment-intent-row

**Chosen**: reservation lives on `payment_intents`; `coupons` are created only on `payment_succeeded`.

**Rejected**: create `coupons` with `status='reserved'` at tap-time, transition to `active` on payment.

**Rationale**: Creating coupons before payment complicates the coupon state machine (adds `reserved`, `pending_payment`), breaks every existing coupon query (must filter by status), and couples two concerns (inventory reservation vs redeemable entitlement). Keeping coupons as "only exists after paid" preserves the existing `Coupon` semantics and test code. Inventory hold is a payment-intent concern.

### 19.4 Stripe Connect Express / Custom vs Standard

**Chosen**: Standard (matches PRD Section 11.2).

**Rejected**: Express (higher platform compliance surface, unnecessary) and Custom (effectively makes us a payment facilitator).

**Rationale**: Per PRD. Merchant is merchant-of-record, handles their own KYC and disputes via Stripe UI, minimizes our compliance burden. Non-negotiable at product level.

### 19.5 In-chat WhatsApp native payments vs hosted Stripe Checkout

**Chosen**: Stripe Checkout hosted URL sent as a WhatsApp link.

**Rejected**: WhatsApp Native Payments (not yet available in HK).

**Rationale**: Per PRD 17. When Meta launches HK support, the swap is a new `WhatsAppPaymentsAdapter : PaymentGatewayPort`. Clean extension via the port.

### 19.6 BullMQ cron for inventory release vs Postgres `pg_cron`

**Chosen**: BullMQ (existing pattern from `event-dispatch-queue`).

**Rejected**: `pg_cron` extension.

**Rationale**: `pg_cron` adds operational surface (another thing to monitor), Supabase support is pay-tier, and existing BullMQ workers already run. A `release_expired_reservations` job every 60s is trivial to add.

### 19.7 Store full Stripe event payload vs metadata-only

**Chosen**: `payment_intents.raw_provider_payload JSONB` stores full webhook body.

**Rejected**: store only `providerIntentId` and status.

**Rationale**: dispute/chargeback/reconciliation investigations need the raw payload. Storage cost is negligible (few KB per intent). Matches `pos_transactions.raw_payload` convention.

### 19.8 Per-deal payment provider vs merchant-default provider (MVP)

**Chosen**: use merchant default provider for all deals in MVP. `preferredProvider` on purchase-intent request is accepted but usually ignored.

**Rejected**: per-deal provider override.

**Rationale**: MVP ships only Stripe. Multi-provider selection is a Phase 2 concern and adds UI complexity with no value before PayMe/FPS are live.

---

## Appendix A: File inventory (new / modified)

**New domain files**:
- `src/domain/entities/deal.ts`
- `src/domain/entities/payment-intent.ts`
- `src/domain/entities/merchant-payment-account.ts`
- `src/domain/value-objects/money.ts`
- `src/domain/value-objects/inventory-count.ts`
- `src/domain/value-objects/application-fee-bps.ts`
- `src/domain/value-objects/payment-provider-code.ts`
- `src/domain/ports/payment-gateway.ts`
- `src/domain/ports/deal-repository.ts`
- `src/domain/ports/payment-intent-repository.ts`
- `src/domain/ports/merchant-payment-account-repository.ts`

**New application files**:
- `src/application/create-deal.ts`
- `src/application/publish-deal.ts`
- `src/application/cancel-deal.ts`
- `src/application/purchase-deal.ts`
- `src/application/handle-payment-success.ts`
- `src/application/handle-payment-failure.ts`
- `src/application/refund-purchase.ts`
- `src/application/onboard-merchant-stripe.ts`
- `src/application/sync-merchant-account-status.ts`
- `src/application/resolve-application-fee.ts` (pure helper, used by purchase-deal)
- `src/application/payment-gateway-registry.ts`
- Corresponding `__tests__/*.test.ts` for each (TDD, test first)

**Modified application files**:
- `src/application/merchant-redeem-coupon.ts` — add `handlePurchasedRedemption`
- `src/domain/entities/event.ts` — extend `EventType` union

**New infrastructure files**:
- `src/infrastructure/payment/stripe-connect-adapter.ts`
- `src/infrastructure/payment/test-payment-gateway-adapter.ts`
- `src/infrastructure/payment/payment-gateway-contract.test.ts` (shared contract)
- `src/infrastructure/supabase/repositories/deal-repository.ts`
- `src/infrastructure/supabase/repositories/payment-intent-repository.ts`
- `src/infrastructure/supabase/repositories/merchant-payment-account-repository.ts`
- `src/infrastructure/queue/commerce-queue.ts`

**New API routes**:
- `src/app/api/dashboard/deals/route.ts` (POST list, POST create)
- `src/app/api/dashboard/deals/[dealId]/route.ts` (PATCH, GET)
- `src/app/api/dashboard/deals/[dealId]/publish/route.ts`
- `src/app/api/dashboard/deals/[dealId]/cancel/route.ts`
- `src/app/api/dashboard/deals/[dealId]/analytics/route.ts`
- `src/app/api/dashboard/coupons/[couponId]/refund/route.ts`
- `src/app/api/dashboard/payments/stripe/connect/route.ts`
- `src/app/api/dashboard/payments/stripe/resume/route.ts`
- `src/app/api/commerce/purchase-intent/route.ts`
- `src/app/api/webhooks/stripe/route.ts`

**New migrations**:
- `supabase/migrations/025_commerce_deals.sql`
- `supabase/migrations/026_commerce_payment_providers.sql`
- `supabase/migrations/027_commerce_payment_intents.sql`

**Frontend pages** (scope varies per PR):
- `/dashboard/commerce/deals` — list + create
- `/dashboard/commerce/deals/[id]` — detail + analytics + cancel/republish
- `/dashboard/settings/payments` — Stripe connect state + resume
- `/c/[restaurantSlug]/deal/[dealId]` — public deal card landing (link target from WA CTA)
- `/receipts/[couponId]` — (Q2 pending)

---

## Appendix B: Source-file citations

- Use-case orchestration pattern: `src/application/redeem-reward.ts:16-43` (entry), `:65-86` (unique-code retry loop)
- Merchant redemption branching: `src/application/merchant-redeem-coupon.ts:49-60` (add `'purchased'` branch alongside existing shared-vs-personal)
- Coupon entity shape + helpers: `src/domain/entities/coupon.ts:1-37`
- Reward entity shape reference: `src/domain/entities/reward.ts:1-11`
- Atomic SQL pattern: `supabase/migrations/004_enhance_coupons.sql:31-44` (`increment_coupon_uses` / `decrement_coupon_uses`) — precedent for `reserve_deal_inventory` / `release_deal_inventory`
- Points atomic update: `supabase/migrations/022_adjust_member_points.sql` (reuse as-is for purchase points)
- Webhook signature enforcement precedent: `supabase/migrations/024_require_webhook_secret.sql`
- POS webhook idempotency: `src/application/process-pos-webhook.ts:14-74`
- Event emission: `src/application/emit-event.ts:6-61`
- RLS convention: `supabase/migrations/011_multi_tenant_platform_admin.sql:52-99`
- Port/adapter precedent: `src/domain/ports/pos-webhook.ts`, `src/domain/ports/whatsapp-messaging.ts`
- Use-case test style: `src/application/__tests__/redeem-reward.test.ts:82-173`
