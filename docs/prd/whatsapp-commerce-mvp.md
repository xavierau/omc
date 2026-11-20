# PRD: WhatsApp Commerce (Flash Sales & Voucher Sales)

**Product**: OhMyClient (WhatsApp CRM for HK Restaurants)
**Author**: Product Manager
**Date**: 2026-04-20
**Status**: Draft — Awaiting VP-Engineering Approval
**Version**: 1.2

**Changelog**:
- v1.2 (2026-04-20): Formalized pluggable payment provider architecture (`PaymentGatewayPort`). Replaced fixed provider CHECK constraints with `payment_providers` lookup table. Documented future KPay and bbMSL adapter path. Added port-abstraction-leak risk (R9-new).
- v1.1 (2026-04-20): Pivoted from passthrough-software to marketplace model. Added Stripe Connect Standard merchant onboarding. Added application fee revenue stream. Removed SVF licensing concerns (not applicable). Pricing decision deferred.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [User Personas](#2-user-personas)
3. [Jobs to Be Done](#3-jobs-to-be-done)
4. [Feature Scope](#4-feature-scope)
5. [User Stories with Acceptance Criteria](#5-user-stories-with-acceptance-criteria)
6. [Data Model Changes](#6-data-model-changes)
7. [API Contracts](#7-api-contracts)
8. [Event System Integration](#8-event-system-integration)
9. [WhatsApp Integration](#9-whatsapp-integration)
10. [POS Integration](#10-pos-integration)
11. [Payment Integration](#11-payment-integration)
12. [Privacy and Consent](#12-privacy-and-consent)
13. [Refund and Risk Policy](#13-refund-and-risk-policy)
14. [Success Metrics](#14-success-metrics)
15. [Risks and Mitigations](#15-risks-and-mitigations)
16. [Phased Delivery Plan](#16-phased-delivery-plan)
17. [Non-Goals and Out of Scope](#17-non-goals-and-out-of-scope)

---

## 1. Executive Summary

### Problem

HK restaurants sell prepaid vouchers and run flash sales today — but they do it through OpenRice, Klook, Eatigo, and foodpanda. These platforms charge 10-25% commission, own the customer relationship, and return zero first-party data. When a diner buys a HK$200 voucher on OpenRice, the restaurant gets HK$150, no phone number, no visit history, no ability to re-market. The restaurant becomes a commodity supplier in its own loyalty program.

Meanwhile, OhMyClient already owns the restaurant's members, points, POS integration, and WhatsApp channel. We know who the VIPs are. We know their visit frequency. We broadcast to them at 98% open rate. What we cannot do today: let them buy a flash-sale voucher through WhatsApp and have the purchase flow cleanly into the loyalty and POS systems we already run.

The competitive analysis (`docs/research/whatsapp-commerce-competitive-analysis.md`) shows no player combines restaurant-specific loyalty CRM with WhatsApp-native commerce for the HK mid-market F&B segment. SleekFlow and Omnichat have commerce but no loyalty or POS depth. OpenRice has vouchers but no WhatsApp and takes the customer. We sit at an unoccupied intersection.

### Solution

Position OhMyClient as a **commerce marketplace platform** for HK mid-market F&B — not a CRM with bolted-on commerce. Restaurants create **deals** (voucher templates) — flash sales with time windows, inventory caps, purchase prices, and redemption rules. Deals are broadcast via WhatsApp and purchased via a Stripe Connect Standard payment flow (PayMe/FPS supported in Phase 2). The merchant is the merchant-of-record; OhMyClient is the marketplace orchestrator and collects a platform **application fee** on every transaction via Stripe's `application_fee_amount` mechanism.

Because many HK restaurants do not yet have a Stripe account (or even a PayMe for Business account), a **first-class merchant payment onboarding flow** is bundled with commerce: we guide merchants through Stripe Connect Standard hosted onboarding, PayMe for Business application, and FPS configuration. Removing this adoption barrier is the single largest lever on early-cohort activation.

Four capabilities make this defensible:

- **Marketplace + Loyalty fused** — the only marketplace where the merchant's buyers are also first-party CRM members with points, segmentation, and POS history. No competitor has this.
- **Merchant onboarding as a product** — we help the restaurant create its own Stripe / PayMe / FPS setup. OpenRice and Klook do not care whether a restaurant has its own payment stack; we make it the starting point.
- **Cross-brand bundles (Model B/C)** — a Group Boss sells one voucher redeemable across multiple brands. Unique to our multi-brand infrastructure.
- **POS-verified redemption** — coupons redeem through the existing POS integration. No paper, no screenshot fraud, no manual reconciliation.

The existing `coupons`, `rewards`, `coupon_redemptions`, and `pos_transactions` tables already carry ~70% of what we need. MVP is an additive layer: a new `deals` table (parallel to `rewards`), six columns on `coupons`, a `payment_intents` table (including platform fee columns), a `merchant_payment_accounts` table, and the Stripe Connect Standard onboarding flow. No breaking changes.

### Business Impact

| Metric | Expected Impact |
|--------|----------------|
| GMV per Active Restaurant / Month | HK$30K-80K by Phase 2 exit (assumption: 20-30 voucher purchases/month at avg HK$200) |
| **Transaction Revenue (Application Fee)** | Target **2-5%** of GMV via Stripe `application_fee_amount` (final rate TBD — set post-MVP after early-adopter data) |
| SaaS ARPU Uplift | +25-40% (commerce tier upsell on `growth` and `pro` plans) — commerce tier pricing TBD, confirmed post-MVP |
| Customer Repeat Purchase Rate | 35%+ within 90 days (vs. ~12% for OpenRice one-time buyers — assumption) |
| Platform Defensibility | High — restaurant consolidates loyalty + commerce + POS in one system. Switching cost increases materially. |
| New Segment Opening | Restaurants currently losing 15-25% to OpenRice voucher commission |

**Revenue model**: Two revenue streams — (1) a **platform application fee** (target 2-5%, TBD) collected on every transaction via Stripe `application_fee_amount`, and (2) a **tiered SaaS subscription** for commerce features on `growth` and `pro` plans (pricing TBD — to be confirmed post-MVP launch based on early adopter data).

OhMyClient is a **marketplace**: we facilitate the commerce contract, collect commission, and orchestrate the customer experience. The merchant remains the merchant-of-record under Stripe Connect Standard — they handle settlement, disputes, and tax at the gateway layer. Voucher sales via our platform do not require additional HK financial licensing; KYC obligations sit at the Stripe layer on the merchant and are handled by Stripe's hosted onboarding. See Section 11 for payment architecture rationale.

---

## 2. User Personas

The commerce feature affects all three existing personas. Focus here is on what changes for each — assume the base profiles from the multi-brand PRD.

### Persona 1: Multi-Brand Owner ("Group Boss")

**Commerce-Specific Pain Points**:
- Runs flash sales on OpenRice per-brand because OpenRice does not support cross-brand bundles
- Cannot target VIPs across brands with exclusive offers
- Loses 12-20% margin to aggregator commissions across 2-8 shops — compounds to significant annual leakage
- Cannot run a "buy HK$200 at Sushi Ko, get HK$50 off Pasta House" bundle even though it is the most obvious cross-sell

**Merchant Onboarding Readiness**:
- Most Group Bosses already have corporate banking + FPS set up. ~40% have a Stripe account (especially those with prior e-commerce or delivery app operations). ~60% have PayMe for Business. Onboarding friction is moderate — they understand the value and move fast.

**What Commerce Enables**:
- Cross-brand voucher bundles (unique to our infrastructure)
- Portfolio-level flash sale dashboard: "Sold 450 vouchers across 3 brands this weekend"
- VIP-only early access windows (leverages our member segmentation)

### Persona 2: Single-Brand Owner ("Solo Owner")

**Commerce-Specific Pain Points**:
- Would run flash sales but finds paper vouchers a operational nightmare (fraud, staff training, reconciliation)
- Currently uses OpenRice vouchers grudgingly; hates the 15% take rate
- Wants to run "lunch-hour weekday flash sale" but has no channel other than Instagram stories

**Merchant Onboarding Readiness**:
- **Many start with neither Stripe nor PayMe for Business.** They typically accept cash, Octopus, and FPS via personal bank QR. Stripe is perceived as "for online shops," PayMe for Business is known but the application feels bureaucratic. This is the highest-friction persona for payment onboarding — and the biggest win if we streamline it. Guided onboarding is the single biggest activation lever for this segment.

**What Commerce Enables**:
- Sell vouchers via WhatsApp to existing members with a transparent platform fee (far below OpenRice's 15-25%)
- POS auto-redemption removes the staff operations burden
- Can run flash sales on slow nights with inventory caps (no oversell risk)
- Guided Stripe Connect Standard setup inside the dashboard — no separate signup journey

### Persona 3: End Customer ("Diner")

**Commerce-Specific Pain Points**:
- Buys vouchers on OpenRice/Klook and then has to remember they exist, find the PDF, show the staff a screenshot
- Has been burned by expired vouchers (Consumer Council complaint pattern)
- Distrusts small restaurant prepaid schemes after several HK bankruptcies (Yat Lok, Shark Fin City) left voucher holders stranded

**What Commerce Enables**:
- Buys voucher in WhatsApp, receives coupon code + QR in same WhatsApp thread, redeems at POS — zero friction
- Sees expiry clearly, gets reminder 7/3/1 days before expiry
- Refund policy and escrow protections visible at purchase time (addresses Consumer Council concerns)

---

## 3. Jobs to Be Done

### Group Boss / Solo Owner (Merchant)

| When... | I want to... | So I can... |
|---------|-------------|-------------|
| I have empty tables on a Tuesday night | Launch a 4-hour flash sale for 50 HK$100-for-HK$80 vouchers | Fill tables tonight without burning margin with a permanent discount |
| I launch a new menu | Sell HK$500 prepaid vouchers with 20% bonus to my top 100 members | Get upfront cash flow and lock in VIP visits |
| I run a cross-brand promo (Model B/C) | Sell one voucher valid at any of my 4 brands | Cross-sell to customers who only know one of my brands |
| I look at flash sale performance | See sold, redeemed, outstanding, GMV per deal in real time | Decide whether to extend, re-run, or kill the sale |
| A customer asks for a refund | Process it through OhMyClient, not my payment provider dashboard | Keep the member record, points adjustment, and refund ledger in one place |

### Diner

| When... | I want to... | So I can... |
|---------|-------------|-------------|
| I see a flash sale in WhatsApp | Buy it in 2 taps without leaving the chat | Not miss the deal or fumble with copy-paste payment links |
| I buy a voucher | Know exactly when it expires and what it's worth | Plan my visit and not feel cheated by fine print |
| I arrive at the restaurant | Redeem the voucher at POS with just my phone | Skip screenshots, PDFs, and staff confusion |
| I worry about the restaurant closing | See that my prepaid money is protected | Trust the platform enough to prepay in the first place |
| I earn points | Get points on voucher purchase AND on redemption | Stack rewards like a savvy diner |

---

## 4. Feature Scope

### Architecture Principle: Pluggable Payment Providers

> The payment layer is designed as a port/adapter pattern (Hexagonal). Each provider (Stripe, PayMe, FPS, and future providers like KPay, bbMSL) is implemented as a driven adapter conforming to a single `PaymentGatewayPort` domain interface. Adding a new provider requires: (1) a new adapter implementation, (2) a provider-specific onboarding flow component, (3) a commission-collection strategy. No changes to domain entities, use cases, or existing adapters.

### Payment Provider Tiering

| Feature | MVP (Phase 1) | Phase 2 | Phase 3+ |
|---------|---------------|---------|----------|
| Merchant Payment Onboarding | Stripe Connect Standard | + PayMe, FPS | + KPay, bbMSL, and future providers via adapter pattern |

### MVP (Phase 1)

| Feature | Description | Priority |
|---------|-------------|----------|
| **Merchant Payment Account Onboarding** | Stripe Connect Standard hosted onboarding embedded in our dashboard; guided PayMe for Business application flow (links + instructions); FPS configuration wizard (QR generation + bank instructions). Merchants can skip-and-configure-later but cannot launch a deal without at least one active provider. | **P0** |
| **Application Fee Configuration** | Platform-side configuration for the application fee (basis points) applied to each transaction via Stripe `application_fee_amount`. Default fee set at platform level; per-merchant overrides supported for enterprise contracts. | **P0** |
| Deal Template Creation | Merchant creates a deal: title, description, purchase price, face value, inventory cap, sale window, redemption expiry | P0 |
| Flash Sale Engine | Time-boxed deals with inventory countdown, auto-close on sellout or window end | P0 |
| Payment Intent Creation (Stripe Connect Standard) | Create Stripe PaymentIntent on the merchant's connected account with `application_fee_amount` set; generate hosted Checkout URL | P0 |
| WhatsApp Purchase Flow | Send deal card via WhatsApp, receive payment confirmation, deliver coupon | P0 |
| Coupon Issuance on Purchase | On successful payment webhook, issue a `purchased` coupon to the member | P0 |
| POS Redemption | Reuse existing POS coupon validation flow | P0 |
| Deal Performance Dashboard | Sold, redeemed, outstanding liability, GMV per deal, platform fee collected per deal | P0 |
| Basic Loyalty Hook | Award points on voucher purchase (configurable rate) | P0 |
| WhatsApp Catalog Sync | Push active deals to the restaurant's WhatsApp Catalog | P1 |
| VIP-Only Early Access | Restrict deal visibility to member segments during a pre-window | P1 |
| Refund & Void | Merchant-initiated refund with coupon voiding, points reversal, and **proportional platform fee refund** | P0 |
| Consumer-Facing T&C | Refund policy, expiry grace period, bankruptcy protection displayed at checkout | P0 |

### Phase 2

| Feature | Description | Priority |
|---------|-------------|----------|
| Cross-Brand Voucher Bundles | One deal redeemable across group brands (Model B/C) | P0 |
| Points-as-Payment | Use points to partially or fully pay for a deal (e.g., 500 pts + HK$50) | P1 |
| Bonus Points Multiplier | "Buy this voucher, earn 2x points on redemption" | P1 |
| Gift Vouchers | Buy for self or send to another phone number | P1 |
| Scheduled Flash Sales | Queue up flash sales to auto-launch at target date/time | P2 |
| Waitlist on Sellout | Collect opt-ins from customers who missed a sold-out sale | P2 |

### Phase 3

| Feature | Description | Priority |
|---------|-------------|----------|
| Recurring Subscriptions | "Coffee of the month" type prepaid subscriptions | P2 |
| Group Buy Banquets | Min-quantity-to-unlock deals for large table bookings | P2 |
| In-Chat Native Payments | When Meta launches WhatsApp Payments in HK, switch from payment links to in-chat | P2 |
| Deal Recommendation Engine | Per-member deal ranking based on visit and purchase history | P2 |

---

## 5. User Stories with Acceptance Criteria

### 5.1 Merchant: Deal Creation and Flash Sale

#### WC-01: Create a Flash Sale Deal

**As a** restaurant owner
**I want to** create a flash sale deal with a purchase price, face value, inventory cap, and sale window
**So that** I can run a time-limited voucher promotion without depending on OpenRice

**Acceptance Criteria:**
- [ ] Given I am an admin on a restaurant, when I navigate to Commerce > Deals > New Deal, then I can enter: title, description, hero image, purchase price (HKD), face value or discount (HKD or %), max supply (integer > 0), sale start/end timestamps, redemption expiry (date or N days post-purchase)
- [ ] Given I set face value > purchase price, when I save the deal, then the system displays the implied discount percentage as confirmation
- [ ] Given I set `sale_starts_at` in the future, when I save, then the deal status is `scheduled` and it is not yet visible to customers
- [ ] Given sale_starts_at arrives, when the scheduler runs, then the deal auto-transitions to `active` status and (if configured) broadcasts to the target segment
- [ ] Given I attempt to save with `max_supply = 0` or `sale_ends_at < sale_starts_at`, when I submit, then validation fails with a specific field error
- [ ] Given I save a deal, when the save completes, then an event `deal_created` is emitted with the deal id, restaurant id, and configuration

**Out of Scope:**
- Dynamic pricing based on real-time demand
- A/B testing of deal copy

#### WC-02: Inventory-Capped Purchase

**As a** diner seeing a flash sale in WhatsApp
**I want to** purchase a voucher before it sells out
**So that** I get the deal without worrying about oversell

**Acceptance Criteria:**
- [ ] Given a deal has `max_supply = 50` and `sold_count = 49`, when I tap Buy, then the system attempts to reserve 1 unit via an atomic `SELECT ... FOR UPDATE` and `sold_count += 1` within a single transaction
- [ ] Given my reservation succeeds, when the transaction commits, then a `payment_intents` row is created in `pending` state with a 10-minute expiry and a payment link is returned
- [ ] Given two diners attempt to buy the last unit concurrently, when transactions serialize, then exactly one succeeds and the other receives a `sold_out` error
- [ ] Given I do not complete payment within 10 minutes, when the reservation expires, then `sold_count` is decremented and the unit is returned to inventory
- [ ] Given I complete payment, when the payment webhook fires successfully, then the reservation is committed and a coupon is issued
- [ ] Given `sold_count = max_supply`, when I view the deal, then it is displayed as "Sold Out" and the Buy button is disabled

**Notes:**
- The existing `increment_coupon_uses()` pattern is the precedent. A parallel `reserve_deal_inventory()` Postgres function uses the same row-lock approach.
- Inventory release on expired reservation is handled by a BullMQ scheduled job, not a trigger, to keep the write path fast.

#### WC-03: Deal Performance Dashboard

**As a** restaurant owner
**I want to** see real-time performance for each deal
**So that** I can decide whether to extend or kill it mid-sale

**Acceptance Criteria:**
- [ ] Given I open a deal's detail page, when it loads, then I see: sold count, remaining inventory, GMV (HKD), redemption count, redemption rate (%), outstanding liability (unredeemed vouchers × face value)
- [ ] Given I refresh the page during an active sale, when the data loads, then sold count and GMV reflect sales within the last 5 seconds (max staleness)
- [ ] Given the deal is sold out or window has ended, when I view the page, then I see a post-sale summary with final metrics and a "Run Again" button
- [ ] Given I click Run Again, when I confirm, then a new deal is created pre-filled with the previous config, status `draft`

#### WC-04: Refund a Purchased Voucher

**As a** restaurant owner
**I want to** refund a customer's voucher purchase
**So that** I can handle complaints, errors, and goodwill cases without touching Stripe/PayMe directly

**Acceptance Criteria:**
- [ ] Given a coupon is in `active` state (purchased, not redeemed), when I click Refund, then I am prompted to enter a reason and confirm
- [ ] Given I confirm refund, when processed, then the system: (a) calls the payment provider refund API, (b) sets the coupon to `refunded`, (c) reverses any points awarded on purchase via `adjust_member_points`, (d) decrements `sold_count` if within sale window (for inventory reconciliation), (e) emits a `coupon_refunded` event
- [ ] Given a coupon has already been redeemed, when I attempt to refund, then the system blocks with "Cannot refund redeemed voucher" and suggests a manual goodwill credit instead
- [ ] Given refund provider call fails, when the error is caught, then the coupon state is rolled back to `active` and the merchant is notified
- [ ] Given a refund succeeds, when the customer receives the WhatsApp notification, then the message comes via a `utility` template (not marketing) with refund amount and expected bank posting timeline

### 5.2 Diner: Purchase and Redemption

#### WC-05: Purchase a Voucher via WhatsApp

**As a** diner
**I want to** buy a flash sale voucher in the WhatsApp thread I already trust
**So that** I do not have to leave the chat, create an account, or download an app

**Acceptance Criteria:**
- [ ] Given a merchant broadcasts a deal, when I receive the WhatsApp message, then I see a card with title, image, price, face value, expiry date, remaining quantity (or "Last X left!" if low), and a Buy button (interactive CTA or link)
- [ ] Given I tap Buy, when the deal is available and I am an identified member (phone matches `members.phone`), then I am sent a payment link (Stripe Checkout / PayMe deep link / FPS QR depending on restaurant config)
- [ ] Given I tap Buy but I am not yet a member, when my phone is new, then a `members` row is created automatically with my phone, tagged with `source: 'commerce'`, and the payment link is sent
- [ ] Given I complete payment, when the payment webhook fires, then I receive a WhatsApp `utility` template message within 60 seconds with: coupon code, QR, face value, expiry date, redemption instructions, and T&C link
- [ ] Given I abandon the payment link, when 10 minutes pass, then the inventory reservation expires, I receive an optional "Still interested? Your spot is gone but the sale is still live" reminder (only if deal still active)
- [ ] Given payment succeeds, when the event flows through, then I earn `points_balance += (purchase_price * points_rate)` and receive a points confirmation in the same coupon delivery message

**Notes:**
- 24-hour WhatsApp messaging window applies: purchase confirmation is a `utility` template (billable as utility). Pre-purchase broadcasts are `marketing`.
- For non-members, we defer KYC/consent to minimum legal requirement — phone number is all we need at purchase time. PDPO-compliant consent for future marketing is collected post-purchase.

#### WC-06: Redeem a Purchased Voucher at POS

**As a** diner at the restaurant
**I want to** redeem my voucher at POS by showing my phone
**So that** I do not have to find a PDF, screenshot, or email

**Acceptance Criteria:**
- [ ] Given I hold a valid `purchased` coupon, when staff scans my QR at POS (or I type my code), then the POS integration calls the existing coupon validation endpoint and receives: valid, face_value, any restrictions
- [ ] Given the coupon is valid, when staff applies it to the check, then the POS integration marks the coupon `redeemed` via `increment_coupon_uses` + the existing `coupon_redemptions` ledger
- [ ] Given the coupon is already redeemed, when staff scans, then the POS receives `already_redeemed` with redemption timestamp and the staff is shown the prior receipt reference
- [ ] Given the coupon is expired, when staff scans, then the POS receives `expired` with expiry date; staff cannot override (must call manager)
- [ ] Given the redemption completes, when the transaction settles, then I receive a WhatsApp confirmation: "You redeemed [Voucher Title] (HK$XXX) at [Restaurant]. Points earned on spend: YY."
- [ ] Given the deal has a bonus points multiplier (Phase 2), when I redeem, then I earn (base rate × multiplier) points on the POS transaction total

**Notes:**
- Reuses existing `redeem-coupon` use case. Only change: the use case must recognize `coupon.type = 'purchased'` and branch to skip certain redemption constraints (e.g., minimum points balance — not required for purchased vouchers).

### 5.3 Merchant: Advanced Commerce

#### WC-07: VIP-Only Early Access

**As a** restaurant owner with a VIP member segment
**I want to** give VIPs 24-hour early access to a flash sale before it opens to everyone
**So that** I reward loyalty and create scarcity for the public launch

**Acceptance Criteria:**
- [ ] Given I am creating a deal, when I enable "VIP Early Access," then I can select a member segment (existing segment feature) and a VIP window (e.g., 24 hours before public `sale_starts_at`)
- [ ] Given the VIP window opens, when the scheduler runs, then only members in the selected segment can purchase; the deal is invisible/blocked for others
- [ ] Given a non-VIP somehow obtains the buy link, when they tap Buy, then the system blocks with "This sale opens to all members at [timestamp]"
- [ ] Given VIP early access ends, when `sale_starts_at` arrives, then the deal becomes purchasable by all members
- [ ] Given I review a deal post-sale, when I see the metrics, then I see a breakdown: "X units sold during VIP window, Y during public sale"

#### WC-08: Cross-Brand Voucher Bundle (Phase 2)

**As a** group boss running a Model B or C group
**I want to** create a voucher redeemable at any of my brands
**So that** I cross-sell my customers from one brand to another

**Acceptance Criteria:**
- [ ] Given my group has `loyalty_model IN ('cross_recognition', 'unified')`, when I create a deal, then I see a new "Valid at" field: (a) single brand, (b) specific brands in group, (c) any brand in group
- [ ] Given I select "any brand in group," when the coupon is issued, then `coupon.valid_at_restaurant_ids = []` (empty = all brands) — same convention as group campaigns in multi-brand PRD
- [ ] Given a customer redeems the bundle voucher at Brand X, when the redemption occurs, then the coupon is marked `redeemed` and the redemption is attributed to Brand X for revenue accounting
- [ ] Given a customer is consented-across-brands in the group, when they receive the bundle offer, then the WhatsApp message comes from their home brand (existing convention)
- [ ] Given my group has `loyalty_model = 'separate'`, when I attempt to create a cross-brand bundle, then the UI blocks with "Cross-brand bundles require Cross-Recognition or Unified loyalty model"

### 5.4 Merchant: Payment Onboarding and Platform Revenue

#### WC-09: Merchant Onboards Payment Account

**As a** restaurant owner new to digital payments
**I want to** connect a Stripe account (or PayMe / FPS) through the OhMyClient dashboard
**So that** I can receive money from voucher sales without figuring out payment gateways on my own

**Acceptance Criteria:**

*Stripe — new account path:*
- [ ] Given I have no Stripe account, when I click "Connect Stripe," then I am redirected to Stripe's Connect Standard hosted onboarding URL (generated via Stripe API `account_links.create` with `type='account_onboarding'`) with a return URL back to our dashboard
- [ ] Given I complete Stripe onboarding, when Stripe posts the `account.updated` webhook with `charges_enabled=true, payouts_enabled=true`, then `merchant_payment_accounts.status` moves from `pending` to `active` and `capabilities` JSONB is updated
- [ ] Given I abandon Stripe onboarding mid-flow, when I return to the dashboard, then I see a "Resume Stripe Setup" CTA that re-issues a fresh account link (Stripe links expire in 7 days)

*Stripe — existing account path:*
- [ ] Given I already have a Stripe account, when I click "Connect Stripe" and authorize via Stripe's OAuth-equivalent Connect flow, then `merchant_payment_accounts.provider_account_id` is stored and status is immediately `active` if capabilities allow
- [ ] Given my existing Stripe account lacks required capabilities (e.g., HKD payments), when we detect this, then we show a "Complete capabilities" link that routes back to Stripe

*PayMe for Business:*
- [ ] Given I click "Apply for PayMe for Business," when the guided flow opens, then I see step-by-step instructions with HSBC's PayMe for Business application URL, required documents checklist (BR, bank statement, identity), and a "Mark as submitted" action
- [ ] Given I mark PayMe as submitted, when I later receive PayMe credentials from HSBC, then I can paste them into a dedicated credential form which validates with a test API call

*FPS:*
- [ ] Given I click "Configure FPS," when the wizard opens, then I enter my FPS ID (phone or proxy ID), business name, and a bank of record, and the wizard generates a static FPS QR code tied to my identifier
- [ ] Given FPS is configured, when I review, then I see the reconciliation caveat clearly: "FPS payments require your confirmation in the dashboard to issue the voucher — automated reconciliation is a Phase 2 feature"

*Skip-and-configure-later state:*
- [ ] Given no provider is active, when I navigate to "Create a Deal," then the UI permits deal creation in `draft` state but blocks `launch` with "Connect a payment provider to launch this deal" and a shortcut link to Payments setup
- [ ] Given no provider is active, when I preview commerce features (dashboards, analytics placeholders, deal creation), then I can explore the product end-to-end minus publishing

**Notes:**
- Stripe Connect Standard means the merchant has a fully-independent Stripe account; they log in at dashboard.stripe.com with their own credentials. We never store their Stripe password.
- For Phase 1 pilot merchants, offer **white-glove onboarding**: a PM or CS rep walks the merchant through Stripe KYC over a call. Self-service remains the default path.
- Show an onboarding progress bar (`Stripe 40% complete → Pending Stripe review → Active`) so the merchant always knows where they are.

#### WC-10: Platform Collects Application Fee

**As the** platform operator
**I want to** automatically collect a platform application fee on every voucher purchase
**So that** OhMyClient earns transaction revenue without touching merchant funds

**Acceptance Criteria:**

*Fee calculation:*
- [ ] Given a deal has purchase price HK$160 and the platform fee is configured at 300 basis points (3%), when a PaymentIntent is created on the merchant's connected Stripe account, then the request includes `application_fee_amount = 480` (HK$4.80 in cents)
- [ ] Given the platform fee is configured at the platform level, when a merchant contract specifies a custom rate, then the per-merchant override on `merchant_payment_accounts` (or a dedicated config table) takes precedence
- [ ] Given a purchase succeeds, when the Stripe webhook fires, then `payment_intents.platform_fee_amount` and `payment_intents.platform_fee_currency` record the collected fee

*Refund handling:*
- [ ] Given a coupon is refunded via our refund flow, when the Stripe refund is created with `refund_application_fee=true`, then the merchant is refunded the net amount and the platform fee is **proportionally refunded** to the merchant's Stripe account
- [ ] Given a partial refund (future), when processed, then the platform fee is refunded proportionally (refund_amount / original_amount × original_application_fee)
- [ ] Given a chargeback fires, when the Stripe `charge.dispute.created` webhook is received, then the platform fee is reversed per Stripe's dispute rules and logged on `payment_intents.raw_provider_payload`

*Visibility — merchant dashboard:*
- [ ] Given a merchant views a deal analytics page, when it loads, then they see "Gross Sales: HK$8,000 / Platform Fee: HK$240 / Net Payout: HK$7,760" per deal
- [ ] Given a merchant views their payment account page, when it loads, then they see a monthly summary of platform fees collected with a CSV export

*Visibility — platform admin dashboard:*
- [ ] Given a platform admin opens the commerce revenue page, when it loads, then they see: total GMV, total platform fees collected (this month, this year), fees by merchant (top N), fees by deal type
- [ ] Given a platform admin opens a specific merchant, when they view the payment tab, then they see fee rate, total collected, refunded amount, net

*Transparency (T&C):*
- [ ] Given a merchant signs up for commerce, when they review the merchant T&C, then the platform application fee rate is explicitly disclosed (e.g., "OhMyClient collects a X% application fee on each transaction")

**Notes:**
- We use Stripe's `application_fee_amount` on the PaymentIntent (reference: https://docs.stripe.com/connect/direct-charges#collect-fees).
- For PayMe and FPS (Phase 2), platform fees cannot be split at the gateway level. We invoice the merchant monthly for the calculated commission. See Section 11.
- Consumer-facing checkout does not need to expose the platform fee (merchant sets face value and sale price; the fee is between platform and merchant). Merchant T&C disclosure is sufficient.

---

## 6. Data Model Changes

### 6.1 New Tables

#### `payment_providers` (lookup — extensible registry of supported providers)

```sql
CREATE TABLE payment_providers (
  code TEXT PRIMARY KEY,               -- 'stripe','payme','fps','kpay','bbmsl', etc.
  display_name TEXT NOT NULL,
  onboarding_type TEXT NOT NULL,       -- 'hosted_oauth','api_connect','manual_form','guided_external'
  supports_split_payment BOOLEAN NOT NULL DEFAULT false,
  supports_webhook_reconciliation BOOLEAN NOT NULL DEFAULT false,
  commission_strategy TEXT NOT NULL,   -- 'native_application_fee','monthly_invoice','revenue_share'
  is_mvp_supported BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  config_schema JSONB,                 -- JSON schema describing required onboarding fields
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed MVP + near-term providers
INSERT INTO payment_providers (code, display_name, onboarding_type, supports_split_payment, supports_webhook_reconciliation, commission_strategy, is_mvp_supported) VALUES
  ('stripe','Stripe','hosted_oauth',true,true,'native_application_fee',true),
  ('payme','PayMe for Business','guided_external',false,false,'monthly_invoice',false),
  ('fps','FPS','manual_form',false,false,'monthly_invoice',false),
  ('kpay','KPay (Qfpay)','api_connect',false,true,'monthly_invoice',false),
  ('bbmsl','bbMSL (Global Payments)','api_connect',false,true,'monthly_invoice',false);
```

**Why a lookup table instead of a CHECK constraint:**
- Adding a new provider = insert one row in `payment_providers` + ship an adapter. No schema migration required.
- Platform can toggle providers on/off per-environment or per-tenant without a migration (flip `is_active` or `is_mvp_supported`).
- Dashboard can dynamically render available providers based on `is_active` + `is_mvp_supported`.
- `config_schema` drives dynamic onboarding form generation per provider.

#### `deals` (parallel to `rewards`, for purchasable offers)

```sql
CREATE TABLE deals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  group_id UUID REFERENCES restaurant_groups(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  hero_image_url TEXT,
  purchase_price_cents INTEGER NOT NULL CHECK (purchase_price_cents >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'HKD',
  -- Face value: what the voucher is worth at redemption
  discount_type TEXT NOT NULL CHECK (discount_type IN ('fixed_amount', 'percentage', 'item')),
  discount_value_cents INTEGER,         -- for fixed_amount
  discount_percentage NUMERIC(5,2),     -- for percentage, 0-100
  item_description TEXT,                -- for item (e.g., "Wagyu set menu for 2")
  max_supply INTEGER NOT NULL CHECK (max_supply > 0),
  sold_count INTEGER NOT NULL DEFAULT 0 CHECK (sold_count >= 0),
  sale_starts_at TIMESTAMPTZ NOT NULL,
  sale_ends_at TIMESTAMPTZ NOT NULL,
  redemption_expires_at TIMESTAMPTZ,    -- absolute expiry; if null, use redemption_valid_days
  redemption_valid_days INTEGER,        -- days after purchase; if null, use redemption_expires_at
  valid_at_restaurant_ids UUID[] DEFAULT NULL,  -- NULL = owning restaurant only; empty array = all brands in group; non-empty = specific brands
  vip_segment_id UUID REFERENCES member_segments(id) ON DELETE SET NULL,
  vip_window_hours INTEGER DEFAULT 0 CHECK (vip_window_hours >= 0),
  points_earn_rate NUMERIC(5,3) NOT NULL DEFAULT 0,  -- points per HKD spent
  application_fee_bps INTEGER,          -- per-deal override of platform fee in basis points; NULL = use platform/merchant default
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'scheduled', 'active', 'sold_out', 'ended', 'cancelled')),
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (sale_ends_at > sale_starts_at),
  CHECK (
    (discount_type = 'fixed_amount' AND discount_value_cents IS NOT NULL) OR
    (discount_type = 'percentage' AND discount_percentage IS NOT NULL) OR
    (discount_type = 'item' AND item_description IS NOT NULL)
  ),
  CHECK (
    (redemption_expires_at IS NOT NULL) OR (redemption_valid_days IS NOT NULL)
  )
);
CREATE INDEX idx_deals_restaurant ON deals(restaurant_id);
CREATE INDEX idx_deals_group ON deals(group_id);
CREATE INDEX idx_deals_status_window ON deals(status, sale_starts_at, sale_ends_at);
```

**Notes:**
- `deals` is a template. Each purchase produces a `coupons` row with `deal_id` FK.
- `valid_at_restaurant_ids` convention matches the multi-brand PRD Section 6 (group_campaigns.coupon_valid_at).
- `sold_count` is updated atomically by `reserve_deal_inventory()`.
- `application_fee_bps` allows per-deal override. Fee resolution order: deal override → merchant override (on `merchant_payment_accounts`) → platform default (config). Keeping all three keeps the pricing decision deferrable.

#### `payment_intents` (payment reservation and status tracking)

```sql
CREATE TABLE payment_intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE RESTRICT,
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'HKD',
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  provider TEXT NOT NULL REFERENCES payment_providers(code),  -- FK to extensible lookup
  provider_intent_id TEXT,              -- Stripe PaymentIntent id, PayMe order id, etc.
  provider_checkout_url TEXT,           -- the link we send to the customer
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'succeeded', 'failed', 'expired', 'refunded', 'partially_refunded')),
  reserved_until TIMESTAMPTZ NOT NULL,  -- inventory hold expiry
  paid_at TIMESTAMPTZ,
  refunded_at TIMESTAMPTZ,
  refund_reason TEXT,
  platform_fee_amount INTEGER,          -- platform application fee collected (cents); NULL until payment succeeds
  platform_fee_currency CHAR(3),        -- currency of the platform fee (usually same as amount_currency)
  platform_fee_refunded INTEGER DEFAULT 0,  -- cumulative fee refunded on this intent (cents)
  raw_provider_payload JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_pi_deal ON payment_intents(deal_id);
CREATE INDEX idx_pi_member ON payment_intents(member_id);
CREATE INDEX idx_pi_status_expiry ON payment_intents(status, reserved_until);
CREATE UNIQUE INDEX idx_pi_provider_intent ON payment_intents(provider, provider_intent_id)
  WHERE provider_intent_id IS NOT NULL;
```

**Notes:**
- `reserved_until` is the 10-minute inventory hold. A scheduled job sweeps `WHERE status='pending' AND reserved_until < NOW()` and returns inventory.
- `raw_provider_payload` stores the raw webhook body for audit and dispute handling.
- No PII of payment methods is stored — that lives with the provider.
- `platform_fee_amount` is populated from the Stripe webhook on successful charge (reads `application_fee_amount` or derives from `charges.data[0].application_fee_amount`).

#### `merchant_payment_accounts` (per-merchant provider linkage)

```sql
CREATE TABLE merchant_payment_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  provider TEXT NOT NULL REFERENCES payment_providers(code),  -- FK to extensible lookup
  provider_account_id TEXT,              -- e.g., Stripe acct_xxx, PayMe merchant ID, FPS identifier, KPay merchant ID, bbMSL merchant ID
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'restricted', 'disabled')),
  onboarding_url TEXT,                   -- Stripe hosted onboarding URL (short-lived)
  onboarding_url_expires_at TIMESTAMPTZ,
  capabilities JSONB DEFAULT '{}',       -- what the account can do (e.g., card_payments, hkd, payouts_enabled)
  application_fee_bps_override INTEGER,  -- per-merchant override (basis points); NULL = platform default
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  last_webhook_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  activated_at TIMESTAMPTZ,
  UNIQUE(restaurant_id, provider)
);
CREATE INDEX idx_mpa_restaurant ON merchant_payment_accounts(restaurant_id);
CREATE INDEX idx_mpa_status ON merchant_payment_accounts(status);
```

**Notes:**
- Replaces the earlier `restaurant_payment_providers` sketch in Section 11.4 — this is the canonical table going forward. Section 11 has been rewritten to reference this.
- For Stripe, `provider_account_id` is the `acct_xxx` from Stripe Connect Standard. No secret keys stored — we call Stripe with our platform key on the merchant's behalf using the `Stripe-Account` header.
- For PayMe, credentials are stored encrypted in a companion secret store keyed by `merchant_payment_accounts.id`.
- For FPS, `provider_account_id` stores the FPS identifier (phone or proxy); no credentials needed.
- `application_fee_bps_override` supports custom deals with enterprise customers without changing platform defaults.

### 6.2 Modified Tables

#### `coupons` — Add commerce columns

```sql
ALTER TABLE coupons ADD COLUMN deal_id UUID REFERENCES deals(id) ON DELETE SET NULL;
ALTER TABLE coupons ADD COLUMN payment_intent_id UUID REFERENCES payment_intents(id) ON DELETE SET NULL;
ALTER TABLE coupons ADD COLUMN purchase_price_cents INTEGER;
ALTER TABLE coupons ADD COLUMN currency CHAR(3);
ALTER TABLE coupons ADD COLUMN purchased_at TIMESTAMPTZ;
ALTER TABLE coupons ADD COLUMN refunded_at TIMESTAMPTZ;

-- Extend type check constraint to include 'purchased'
ALTER TABLE coupons DROP CONSTRAINT IF EXISTS coupons_type_check;
ALTER TABLE coupons ADD CONSTRAINT coupons_type_check
  CHECK (type IN ('campaign', 'reward', 'manual', 'purchased'));

-- Extend status check to support refund states
ALTER TABLE coupons DROP CONSTRAINT IF EXISTS coupons_status_check;
ALTER TABLE coupons ADD CONSTRAINT coupons_status_check
  CHECK (status IN ('active', 'redeemed', 'expired', 'voided', 'refunded', 'partially_refunded'));

CREATE INDEX idx_coupons_deal ON coupons(deal_id);
CREATE INDEX idx_coupons_payment_intent ON coupons(payment_intent_id);
```

#### `events` — Add commerce event types

```sql
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_type_check;
ALTER TABLE events ADD CONSTRAINT events_type_check
  CHECK (type IN (
    'join', 'redeem', 'receipt', 'campaign', 'points',
    'unsubscribe', 'reward_redeem',
    'pos_transaction', 'pos_refund', 'pos_customer_link',
    'integration_error',
    'cross_brand_recognition', 'cross_brand_consent',
    'points_transfer', 'group_campaign',
    -- New commerce event types
    'deal_created', 'deal_launched', 'deal_sold_out', 'deal_ended',
    'deal_purchased', 'deal_purchase_failed',
    'coupon_refunded', 'payment_webhook'
  ));
```

### 6.3 New Postgres Functions

#### `reserve_deal_inventory`

```sql
CREATE OR REPLACE FUNCTION reserve_deal_inventory(
  p_deal_id UUID,
  p_quantity INTEGER,
  p_reservation_minutes INTEGER DEFAULT 10
) RETURNS TABLE (
  reserved_count INTEGER,
  new_sold_count INTEGER
)
LANGUAGE plpgsql AS $$
DECLARE
  v_max_supply INTEGER;
  v_sold_count INTEGER;
  v_sale_starts TIMESTAMPTZ;
  v_sale_ends TIMESTAMPTZ;
  v_status TEXT;
BEGIN
  SELECT max_supply, sold_count, sale_starts_at, sale_ends_at, status
    INTO v_max_supply, v_sold_count, v_sale_starts, v_sale_ends, v_status
    FROM deals WHERE id = p_deal_id FOR UPDATE;

  IF v_status NOT IN ('active', 'scheduled') THEN
    RAISE EXCEPTION 'Deal is not purchasable (status: %)', v_status;
  END IF;
  IF NOW() < v_sale_starts OR NOW() > v_sale_ends THEN
    RAISE EXCEPTION 'Sale window is not open';
  END IF;
  IF v_sold_count + p_quantity > v_max_supply THEN
    RAISE EXCEPTION 'Insufficient inventory. Remaining: %, requested: %',
      v_max_supply - v_sold_count, p_quantity;
  END IF;

  UPDATE deals SET sold_count = sold_count + p_quantity,
                   status = CASE
                     WHEN sold_count + p_quantity >= max_supply THEN 'sold_out'
                     ELSE status
                   END,
                   updated_at = NOW()
    WHERE id = p_deal_id;

  RETURN QUERY SELECT p_quantity, v_sold_count + p_quantity;
END;
$$;
```

#### `release_expired_reservations` (called by scheduled job)

```sql
CREATE OR REPLACE FUNCTION release_expired_reservations()
RETURNS INTEGER
LANGUAGE plpgsql AS $$
DECLARE
  v_released INTEGER := 0;
BEGIN
  WITH expired AS (
    UPDATE payment_intents
      SET status = 'expired', updated_at = NOW()
      WHERE status = 'pending' AND reserved_until < NOW()
      RETURNING deal_id, quantity
  ),
  returned AS (
    UPDATE deals d
      SET sold_count = sold_count - e.quantity,
          status = CASE WHEN status = 'sold_out' THEN 'active' ELSE status END,
          updated_at = NOW()
      FROM expired e
      WHERE d.id = e.deal_id
      RETURNING 1
  )
  SELECT COUNT(*) INTO v_released FROM returned;
  RETURN v_released;
END;
$$;
```

### 6.4 RLS Policies

`deals` and `payment_intents` follow the existing per-restaurant RLS pattern:

- Merchant read/write access via `user_tenants` matching `deals.restaurant_id`
- Platform admin via `is_platform_admin()`
- Diners never query these tables directly — they access via the public-facing API which filters by `status IN ('active', 'scheduled')` and `payment_intents.member_id = current_member()`

### 6.5 Entity Relationship Diagram (Text)

```
restaurants (1) ──< deals (1) ──< payment_intents (1) ──< coupons
                     │                                       ^
                     │                                       │
                     └──── coupons (deal_id, type='purchased')

coupons ──< coupon_redemptions (existing, reused as-is)
```

---

## 7. API Contracts

### 7.1 Merchant: Deal Management

#### `POST /api/dashboard/deals`

```typescript
// Request
{
  restaurantId: string
  title: string
  description?: string
  heroImageUrl?: string
  purchasePriceCents: number
  currency: 'HKD'
  discountType: 'fixed_amount' | 'percentage' | 'item'
  discountValueCents?: number
  discountPercentage?: number
  itemDescription?: string
  maxSupply: number
  saleStartsAt: string  // ISO 8601
  saleEndsAt: string
  redemptionExpiresAt?: string
  redemptionValidDays?: number
  validAtRestaurantIds?: string[]  // omit or null = owning restaurant only
  vipSegmentId?: string
  vipWindowHours?: number
  pointsEarnRate?: number
}

// Response 201: Deal object
// Errors
// 400: invalid window (sale_ends_at <= sale_starts_at)
// 400: cross-brand valid_at requires group loyalty_model != 'separate'
// 403: user is not admin on restaurant
```

#### `PATCH /api/dashboard/deals/[dealId]`

Update draft or scheduled deal. Restrictions once `active`: cannot reduce `max_supply` below `sold_count`; cannot extend `sale_starts_at` past `sale_ends_at`.

#### `POST /api/dashboard/deals/[dealId]/launch`

Transition `draft` or `scheduled` deal to `active` (overrides schedule).

```typescript
// Response 200
{ id: string, status: 'active', saleStartsAt: string, saleEndsAt: string }
```

#### `POST /api/dashboard/deals/[dealId]/cancel`

Cancel an active deal. All unredeemed purchased coupons remain valid until expiry; only sale is closed.

#### `GET /api/dashboard/deals/[dealId]/analytics`

```typescript
// Response 200
{
  dealId: string
  soldCount: number
  remainingInventory: number
  grossMerchandiseValueCents: number
  redemptionCount: number
  redemptionRate: number          // redeemed / sold
  outstandingLiabilityCents: number  // unredeemed_count * face_value
  vipWindowSales: number
  publicWindowSales: number
  refundCount: number
  refundedAmountCents: number
  perHourSales: { hour: string, count: number }[]
}
```

### 7.2 Diner-Facing: Purchase

#### `POST /api/commerce/purchase-intent`

Called when a diner taps Buy. Must be authenticated against the phone number (magic link via WhatsApp or validated session).

```typescript
// Request
{
  dealId: string
  phone: string           // E.164
  quantity?: number       // default 1, max 5
  preferredProvider?: 'stripe' | 'payme' | 'fps'  // else merchant default
}

// Response 201
{
  paymentIntentId: string
  checkoutUrl: string     // payment link to hand to customer
  reservedUntil: string   // ISO 8601
  amountCents: number
}

// Errors
// 409: sold_out
// 400: outside sale window
// 400: VIP-only window, phone not in segment
// 429: rate limited (abuse prevention)
```

#### `POST /api/webhooks/payments/[provider]`

Payment webhook ingestion (Stripe, PayMe, FPS). HMAC-validated per provider. Idempotency enforced via `provider_intent_id` unique index.

On `payment_succeeded`:
1. Mark `payment_intents.status = 'succeeded'`
2. Issue `coupons` row with `type='purchased'`, `deal_id`, `payment_intent_id`
3. Award purchase points via existing `adjust_member_points`
4. Emit `deal_purchased` event
5. Send WhatsApp utility template with coupon

On `payment_failed` or `payment_expired`:
1. Mark `payment_intents.status`
2. Decrement `deals.sold_count` (release inventory)
3. Emit `deal_purchase_failed` event

### 7.3 Merchant: Refund

#### `POST /api/dashboard/coupons/[couponId]/refund`

```typescript
// Request
{ reason: string, refundPurchasePoints: boolean }

// Response 200
{
  couponId: string
  status: 'refunded'
  refundedAmountCents: number
  platformFeeRefundedCents: number  // proportional application fee returned to merchant
  providerRefundId: string
  pointsReversed: number
}

// Errors
// 400: coupon already redeemed
// 400: coupon already refunded
// 502: provider refund failed

// Notes: Stripe refund is issued with `refund_application_fee=true` so the
// platform fee is refunded proportionally to the merchant's Stripe account.
```

---

## 8. Event System Integration

### 8.1 New Event Types

| Event Type | Trigger | `dataJson` Payload |
|------------|---------|-------------------|
| `deal_created` | Merchant creates a deal | `{ dealId, restaurantId, maxSupply, saleStartsAt, saleEndsAt }` |
| `deal_launched` | Deal transitions to `active` | `{ dealId, restaurantId, launchedAt }` |
| `deal_sold_out` | `sold_count` reaches `max_supply` | `{ dealId, restaurantId, soldAt, totalSold }` |
| `deal_ended` | Sale window ends | `{ dealId, restaurantId, totalSold, totalGmvCents }` |
| `deal_purchased` | Payment webhook confirms purchase | `{ dealId, couponId, paymentIntentId, memberId, amountCents, provider }` |
| `deal_purchase_failed` | Payment fails or expires | `{ dealId, paymentIntentId, memberId, reason }` |
| `coupon_refunded` | Merchant refunds a coupon | `{ couponId, dealId, memberId, refundedAmountCents, reason }` |
| `payment_webhook` | Raw provider webhook received | `{ provider, intentId, eventType, status }` |

### 8.2 Listener Wiring

The existing `emitEvent()` supports per-restaurant scoping. For cross-brand deals (Phase 2), we follow the multi-brand PRD Section 8 convention: primary event at `deals.restaurant_id`, optional fan-out to sibling restaurants via `emitGroupEvent()` when `deals.valid_at_restaurant_ids` spans multiple brands.

Default listeners to wire up in MVP:
- `deal_purchased` → send utility WhatsApp template with coupon + QR
- `deal_purchased` → award purchase points via existing points listener
- `deal_sold_out` → optional restaurant-side notification ("Your flash sale sold out!")
- `coupon_refunded` → send refund confirmation utility message

### 8.3 Idempotency

Payment webhooks are retried by providers. The webhook handler must be idempotent:
- Key: `(provider, provider_intent_id, event_type)`
- Implementation: unique index on `payment_intents.provider_intent_id` + `ON CONFLICT DO NOTHING` for coupon issuance.
- Coupons issued from webhook include `payment_intent_id` which is unique per successful purchase.

---

## 9. WhatsApp Integration

### 9.1 Template Inventory

All customer-facing messages use WhatsApp-approved templates. MVP templates:

| Template Name | Category | Variables | Purpose |
|---------------|----------|-----------|---------|
| `commerce_deal_broadcast` | marketing | `{{deal_title}}`, `{{price}}`, `{{face_value}}`, `{{expiry}}`, `{{remaining}}`, `{{cta_url}}` | Announce a new flash sale |
| `commerce_deal_last_chance` | marketing | `{{deal_title}}`, `{{remaining}}`, `{{cta_url}}` | 2-hour-before-end reminder |
| `commerce_purchase_confirmation` | utility | `{{voucher_title}}`, `{{face_value}}`, `{{coupon_code}}`, `{{qr_url}}`, `{{expiry}}`, `{{tnc_url}}` | Delivered on payment success |
| `commerce_redemption_confirmation` | utility | `{{voucher_title}}`, `{{restaurant_name}}`, `{{points_earned}}` | Delivered on POS redemption |
| `commerce_expiry_reminder_7d` | utility | `{{voucher_title}}`, `{{expiry}}`, `{{face_value}}` | 7 days before redemption expiry |
| `commerce_expiry_reminder_1d` | utility | `{{voucher_title}}`, `{{expiry}}` | 1 day before expiry |
| `commerce_refund_confirmation` | utility | `{{voucher_title}}`, `{{refund_amount}}`, `{{provider}}`, `{{eta_days}}` | Delivered after merchant refund |
| `commerce_vip_early_access` | marketing | `{{deal_title}}`, `{{public_launch_at}}`, `{{cta_url}}` | VIP pre-window notice |

### 9.2 Marketing vs Utility Rule

Strictly applied:
- **Before purchase** = marketing template (promotional, billable as marketing category per Meta 2025 pricing)
- **After purchase** (confirmation, redemption, expiry reminders, refund) = utility template
- **Within 24-hour service window** after diner messages us = free-form text allowed

Violating this causes template rejection, account quality degradation, and (in extreme cases) number suspension. The template catalog is hard-coded; developers cannot bypass.

### 9.3 Catalog Sync (P1)

WhatsApp Business Catalog via Meta Graph API. Each active `deal` syncs as a catalog product. On `deal_sold_out` or `deal_ended`, the product is marked out-of-stock or hidden.

Kapso BSP path: use existing `whatsAppMessagingPort` abstraction; add a `CatalogPort` interface. Phase 1 ships without catalog — message-based cards are sufficient to launch. Phase 1.5 adds catalog.

### 9.4 Purchase Card Format

Interactive message template with:
- Image (hero)
- Title + face value + price prominently
- Countdown text ("Sale ends in 3h 24m" or "Only 5 left")
- CTA button: "Buy Now"
- Tappable link to T&C (refund policy, expiry)

CTA leads to either a hosted checkout (Stripe) or a deep-linked payment (PayMe/FPS). No data is collected between the tap and the payment provider — we pre-reserve inventory at tap time.

---

## 10. POS Integration

### 10.1 Redemption Flow (Reused)

No changes to POS webhook routing. The existing coupon redemption flow handles `purchased` coupons with these amendments in the use case layer:

1. POS sends coupon code → existing validation endpoint
2. Validation reads `coupons` row; if `type='purchased'`, skip reward-specific checks (no points deduction needed — it was already paid in cash)
3. POS applies the face value to the check (fixed_amount, percentage, or item replacement)
4. POS sends `redeem` callback → `increment_coupon_uses` + `coupon_redemptions` ledger entry
5. Event `redeem` emitted with `couponType='purchased'`; points listener awards POS transaction points (if `points_earn_rate` on deal)

### 10.2 Refund Edge Case

If a POS transaction is refunded via the existing `pos_refund` flow AFTER a purchased coupon was redeemed, the merchant has two options (exposed in dashboard):
- **Void only** — POS sale reversed, coupon remains redeemed (customer keeps the consumed benefit)
- **Restore and refund** — POS sale reversed, coupon re-opened (`status='active'`, `redeemed_at=null`), customer can redeem again. Requires manager approval because it enables abuse if misused.

Default is **Void only**. "Restore and refund" is rare and logged for audit.

### 10.3 Offline POS Tolerance

HK POS systems occasionally run offline (Wi-Fi drops). The existing `increment_coupon_uses` function is synchronous. For MVP, we require the POS to be online to redeem a purchased coupon. Phase 2 may add an offline validation token (signed JWT with coupon state at print time) to allow offline redemption with eventual consistency.

---

## 11. Payment Integration & Provider Architecture

### 11.1 PaymentGatewayPort — The Unified Contract

Every payment provider (Stripe in MVP; PayMe, FPS in Phase 2; KPay, bbMSL in Phase 3) is a **driven adapter** behind a single domain interface. Use cases and domain entities depend on the port, not on any concrete implementation.

```ts
interface PaymentGatewayPort {
  // Merchant onboarding
  initiateMerchantOnboarding(restaurantId: string): Promise<OnboardingSession>
  checkMerchantStatus(accountId: string): Promise<MerchantStatus>

  // Payment lifecycle
  createPaymentIntent(params: CreatePaymentIntentParams): Promise<PaymentIntent>
  getPaymentIntent(intentId: string): Promise<PaymentIntent>
  refundPayment(intentId: string, amountCents: number, reason: string): Promise<RefundResult>

  // Reconciliation
  handleWebhook(payload: unknown, signature: string): Promise<WebhookEvent[]>
  reconcileDaily(dateRange: DateRange): Promise<ReconciliationReport>

  // Commission collection
  getCommissionStrategy(): 'native_application_fee' | 'monthly_invoice' | 'revenue_share'
  computeCommission(amountCents: number, bps: number): CommissionResult
}
```

**Adapter resolution**: At runtime, use cases receive the correct adapter by resolving `merchant_payment_accounts.provider` against an adapter registry. Every provider — `StripeAdapter`, `PayMeAdapter`, `FpsAdapter`, `KPayAdapter`, `bbMSLAdapter` — implements `PaymentGatewayPort`. Commission-strategy differences (native split vs monthly invoice vs revenue share) are encapsulated inside the adapter and surfaced to use cases via `getCommissionStrategy()`.

**Port discipline**: The port must not leak Stripe-specific concepts (e.g., `application_fee_amount`, `Stripe-Account` header, `charges.data[0]`). These belong inside `StripeAdapter`. This is enforced in code review and by a stub `TestPaymentGatewayAdapter` that proves the port is not Stripe-coupled.

### 11.2 Architecture Decision: Marketplace with Stripe Connect Standard

OhMyClient is a **commerce marketplace**. We facilitate the transaction, collect a platform application fee, and orchestrate the end-to-end commerce experience. The merchant remains the merchant-of-record for settlement, disputes, tax, and consumer-facing refunds at the payment gateway layer.

The payment architecture is **Stripe Connect Standard**:

- The merchant has their own fully-independent Stripe account (they log in at dashboard.stripe.com with their own credentials).
- Stripe handles the merchant's KYC end-to-end via their hosted onboarding flow. There is no additional HK financial licensing burden on OhMyClient for voucher sales — Stripe is the licensed payment processor, the merchant is the merchant-of-record.
- We charge an **application fee** on each transaction via Stripe's `application_fee_amount` parameter on the PaymentIntent. Reference: https://docs.stripe.com/connect/direct-charges
- Funds settle directly to the merchant's Stripe balance (minus Stripe processing fees and our application fee). Stripe pays the merchant on their standard payout schedule.

Why Stripe Connect **Standard** (not Express or Custom):

| Account Type | Fit for OhMyClient MVP | Decision |
|--------------|------------------------|----------|
| **Standard** | Merchant has full Stripe account; minimal platform compliance burden; merchant sees/uses full Stripe dashboard; merchant handles disputes in Stripe UI | **Selected** |
| Express | Stripe handles onboarding but the account is partially managed by the platform; higher platform responsibility; unnecessary for our use case | Rejected |
| Custom | Maximum platform control; significant compliance lift; we effectively become a payment facilitator | Rejected |

Revenue: two streams — (1) platform application fee on every transaction (target 2-5%, **final rate TBD post-MVP**); (2) commerce SaaS tier on `growth` and `pro` plans (pricing TBD post-MVP, set based on early adopter data).

### 11.3 Provider Support by Phase

| Provider | Phase | Integration |
|----------|-------|-------------|
| **Stripe Connect Standard** | **MVP (Phase 1)** | Full marketplace flow: PaymentIntent on connected account with `application_fee_amount`; hosted Checkout; webhook-driven settlement |
| **PayMe for Business** | Phase 2 | Merchant has PayMe for Business via HSBC. We generate payment requests; PayMe does not support native split payments or application fees. Commission collected via **monthly invoice** to the merchant (platform-side calculation). |
| **FPS** | Phase 2 | Static/dynamic QR tied to merchant's FPS ID. No native split or webhook. Reconciliation via merchant confirmation in-dashboard or nightly bank statement match (where bank API available). Commission via **monthly invoice**. |
| **KPay (Qfpay)** | Phase 3+ | API-based merchant connection. Commission via monthly invoice. Webhook reconciliation supported. See 11.6. |
| **bbMSL (Global Payments)** | Phase 3+ | API-based card acquirer. Commission via monthly invoice. Webhook reconciliation supported. See 11.6. |

The MVP ships Stripe-only. This is a conscious scope decision: Stripe is the only provider where we can take our application fee at the gateway (clean, automated, audit-friendly). PayMe and FPS require invoicing workflows that introduce credit risk and operational overhead — best deferred to Phase 2 once we have merchant relationships and payment history.

### 11.4 Merchant Onboarding Flow (Stripe Connect Standard)

See user story WC-09 for full acceptance criteria. Summary:

1. Merchant visits Settings > Payments > Connect Stripe
2. Platform calls Stripe `accounts.create({ type: 'standard', country: 'HK' })` → receives `acct_xxx`
3. Platform calls Stripe `account_links.create({ account: acct_xxx, type: 'account_onboarding', refresh_url, return_url })` → receives a time-limited hosted onboarding URL
4. Merchant completes Stripe KYC on Stripe's hosted UI (business details, identity verification, bank account)
5. Stripe posts `account.updated` webhook when `charges_enabled` and `payouts_enabled` flip to `true`
6. `merchant_payment_accounts.status` → `active`; merchant can now launch deals

For merchants who **already** have a Stripe account, we use the Stripe Connect OAuth flow instead of creating a new account. Stored in the same `merchant_payment_accounts.provider_account_id`.

### 11.5 Payment Flow (Per Transaction — Stripe Connect Standard)

1. Diner taps Buy in WhatsApp → `POST /api/commerce/purchase-intent`
2. Platform reserves inventory via `reserve_deal_inventory()`
3. Platform resolves the application fee: deal override → merchant override → platform default (basis points)
4. Platform calls Stripe via the merchant's connected account:
   ```
   stripe.paymentIntents.create({
     amount: purchase_price_cents,
     currency: 'hkd',
     application_fee_amount: calculated_fee_cents,
     metadata: { payment_intent_id, deal_id, member_id }
   }, { stripeAccount: merchant.provider_account_id })
   ```
5. Checkout Session is created and `checkout_url` is returned to the diner
6. Diner completes payment; Stripe posts `payment_intent.succeeded` webhook to our platform endpoint (we receive the event for the connected account)
7. Webhook handler: marks `payment_intents.status='succeeded'`, writes `platform_fee_amount`, issues coupon, awards purchase points, emits `deal_purchased` event, delivers WhatsApp utility template

### 11.6 PayMe and FPS (Phase 2) — Invoice Model

Because PayMe and FPS do not support split payments or application fees at the gateway:

- The merchant receives the full purchase amount directly.
- Platform calculates commission per transaction and accumulates it in a monthly ledger (`platform_invoices` — future table).
- Platform issues a monthly invoice to the merchant (auto-collected via Stripe if configured, otherwise payable manually).
- **Credit risk**: the merchant may refuse to pay the invoice. Mitigation: require a Stripe account on file (even if the merchant primarily uses PayMe/FPS) and auto-charge the Stripe account for unpaid invoices after a grace period; terms of service include this provision.

### 11.7 Future Adapters (Phase 3+) — KPay and bbMSL

Two HK-native providers are on the near-term roadmap. Both are deferred to Phase 3 at earliest, contingent on pilot merchant demand:

- **KPay (Qfpay)** — API-based merchant connection. KPay is the dominant HK F&B payment gateway, supporting Visa/Mastercard, AlipayHK, WeChat Pay, Octopus, FPS, UnionPay, and BoCPay. Restaurants with existing KPay merchant accounts can link via API key + merchant ID. Commission collected via **monthly invoice** (KPay does not support native split payments at time of writing). Webhook reconciliation supported.
- **bbMSL (Global Payments HK)** — API-based card acquirer (Visa/Mastercard), popular with mid-size HK restaurants. Commission collected via **monthly invoice**. Suitable for merchants with existing bbMSL contracts. Webhook reconciliation supported.

**Adapter onboarding SLA**: Once the `PaymentGatewayPort` is stable after MVP, any new provider adapter ships in an estimated **2-3 weeks** of engineering effort — one adapter implementation, one onboarding UI component, one commission-collection path reused from the PayMe/FPS invoicing model.

### 11.8 Idempotency and Reconciliation

- Payment webhooks are idempotent (see 8.3).
- A nightly reconciliation job compares `payment_intents.status='succeeded'` against provider-side reports (Stripe Reports API on the platform account, filtered by connected account; PayMe/FPS transaction exports in Phase 2). Mismatches create an alert for engineering.
- Disputes/chargebacks from the provider create a `coupon_refunded` event automatically. Stripe also reverses the proportional application fee per their dispute rules.

### 11.9 Why No Additional HK Licensing is Required

For clarity given prior drafts raised this:

- OhMyClient does **not** hold funds. Funds settle into the merchant's Stripe balance directly via Stripe Connect Standard. No Stored Value Facility (SVF) license is required.
- Voucher sales via our platform do **not** require additional HK financial licensing. The merchant is selling their own vouchers; we are a software marketplace that orchestrates the sale.
- KYC obligations sit at the **Stripe layer** on the merchant — handled entirely by Stripe's hosted onboarding flow.
- Application fees are a standard marketplace pattern supported natively by Stripe and comply with Stripe's policies for Connect platforms.

---

## 12. Privacy and Consent

### 12.1 PDPO Application

The HK PDPO governs this feature. Commerce introduces new data points: payment intent, purchase history, redemption timing. These are personal data of the diner. Key obligations:

| PDPO Principle | Application |
|---------------|-------------|
| **DPP1 Purpose** | At purchase, the diner is shown: "Your purchase creates a member record (if new) and connects to your existing membership (if you are already a member). This data is used to deliver your voucher, enable redemption, and provide purchase history." |
| **DPP3 Consent for Use** | Purchase data is used for fulfillment by default. Marketing use requires separate opt-in (as today). A diner who bought a voucher but did not opt into marketing receives only utility messages. |
| **DPP6 Access / Correction** | Members can request purchase and redemption history export via WhatsApp command. |
| **Retention** | Purchase records retained 7 years for tax/accounting compliance, per IRD (HK Inland Revenue Department) record-keeping requirements. |

### 12.2 Payment Data Scope

We do not store cardholder data. The payment provider is the data controller for payment methods. OhMyClient stores:
- Amount, currency, provider, provider intent ID
- Payment success/failure status
- Refund status

No card numbers, no CVVs, no expiry dates. PCI scope is kept to the provider.

### 12.3 Marketing Opt-In at Purchase

At purchase confirmation, the diner is offered (in the utility message or a follow-up):
> "Want to hear about future flash sales at [Restaurant]? Reply YES to opt in. Reply STOP any time to unsubscribe."

Opt-in is stored on `members.consent_marketing` (existing column). Default for a new member created via commerce is `pending` — they receive only utility messages until they explicitly opt in.

---

## 13. Refund and Risk Policy

### 13.1 Context: HK Consumer Council Warning

In Q1 2026, the HK Consumer Council publicly flagged prepaid restaurant coupon schemes as high-risk after several HK restaurant bankruptcies left voucher holders with worthless paper. Citing SCMP reporting (referenced in competitive analysis): "consumers should exercise caution when purchasing prepaid restaurant coupons; schemes lack protection when merchants cease operations."

OhMyClient must address this head-on. Consumer trust is the precondition for commerce adoption. Our policy:

### 13.2 Refund Policy (Merchant Default — configurable)

| Scenario | Policy |
|----------|--------|
| Voucher unredeemed, within 7 days of purchase | **Full refund** at diner's request, no questions asked |
| Voucher unredeemed, 8-30 days post-purchase | **Merchant discretion** (goodwill refund recommended) |
| Voucher unredeemed, 31+ days post-purchase, before expiry | **Merchant discretion** |
| Voucher unredeemed, after expiry | No refund; 30-day grace period with reduced value (see 13.3) |
| Voucher partially redeemed | No refund |
| Voucher fully redeemed | No refund |
| Merchant ceases operations | **Platform-facilitated escrow refund** (see 13.4) |

The 7-day unconditional refund is **mandatory platform policy**. Merchants who disable it cannot use commerce features. This is our consumer trust anchor.

### 13.3 Expiry Grace Period

Every purchased voucher has:
- **Primary expiry** — the advertised redemption deadline
- **Grace period** — 30 days after primary expiry during which the voucher can be redeemed at **the original purchase price** (not face value)

Example: HK$200 voucher bought for HK$160 expires March 31. On April 15 (within grace), the diner can still redeem for HK$160 of value (not HK$200). This eliminates "total loss" on forgotten vouchers, which is the Consumer Council's primary concern.

Grace period is **mandatory platform policy**, non-negotiable for merchants using commerce.

### 13.4 Merchant Bankruptcy Protection

OhMyClient is a marketplace orchestrator. Stripe handles fund settlement — our platform does not hold diner funds between purchase and merchant payout. The commerce contract is between the diner and the merchant; OhMyClient orchestrates and enforces platform policy on top.

Consumer protections at the platform layer:

- **Bankruptcy disclosure at purchase** — "This voucher is a prepaid obligation of [Restaurant]. If [Restaurant] ceases operations, refunds are subject to applicable liquidation procedures." (T&C link in every deal card)
- **Voucher transfer to sister brand** (Model B/C only) — If one brand in a group closes, outstanding vouchers can be honored at sister brands in the group (merchant-configurable, default ON for Model B/C)
- **Stripe chargeback fallback** — A diner who paid by card can initiate a chargeback via their issuing bank if the merchant fails to deliver. Stripe handles dispute mechanics; the chargeback webhook auto-voids the coupon in our system.
- **Platform escalation for disputes** — Diners can escalate voucher disputes through a WhatsApp support flow. The platform mediates between merchant and diner but does not guarantee refunds (fund settlement is the merchant's responsibility via Stripe).

### 13.5 T&C Template

Every deal auto-generates a T&C page linked from the purchase card:
- Deal title, seller identity, price, face value, expiry
- 7-day cooling-off right
- 30-day grace period rules
- How to redeem (POS, at which locations)
- Refund request process (WhatsApp or dashboard self-serve)
- Bankruptcy disclosure
- Platform contact for dispute escalation
- PDPO data handling summary

Merchants cannot remove platform-mandated clauses. They can add merchant-specific terms (e.g., "Not valid with other offers").

### 13.6 Fraud and Abuse Controls

| Risk | Control |
|------|---------|
| Coupon code theft (someone redeems before rightful buyer) | Codes are single-use, long, random; redemption binds to member phone at purchase time; POS flow validates phone/member at redemption |
| Bot bulk-buying flash sales | Rate limiting (3 purchase attempts per member per deal per hour); CAPTCHA on suspicious bursts; phone number verification for new members |
| Stolen card chargebacks | Provider (Stripe) handles chargeback; coupon auto-voids on chargeback webhook |
| Merchant issuing vouchers with no intent to honor | KYC-lite at merchant onboarding; suspicious pattern detection (e.g., massive deal far below cost); platform can freeze a merchant's deals pending review |

---

## 14. Success Metrics

All targets are assumptions pending first-cohort data.

### Phase 1 (MVP — 3 months post-launch)

| Metric | Baseline | Target | How Measured |
|--------|----------|--------|-------------|
| Restaurants with ≥1 deal launched | 0 | 40% of `growth`+`pro` tier | `deals` count per restaurant |
| Deals sold through | 0 | 60% of deals hit ≥50% of `max_supply` | deals analytics |
| GMV per active commerce restaurant / month | HK$0 | HK$30K | sum of `coupons.purchase_price_cents` where `deal_id IS NOT NULL` |
| Purchase conversion (card viewed → bought) | N/A | 8% (assumption) | broadcast CTR × checkout completion |
| Coupon redemption rate within expiry | N/A | 75% | redeemed / purchased |
| Refund rate | N/A | <5% of purchases | refund events / purchase events |
| WhatsApp marketing template CTR | Current ~12% | ≥15% on commerce templates (compelling CTAs) | Kapso analytics |

### Phase 2 (6 months post-launch)

| Metric | Target | How Measured |
|--------|--------|-------------|
| Repeat purchase within 90 days | 35% of buyers | unique member purchase counts |
| Cross-brand bundle adoption (Model B/C groups) | 30% of groups create ≥1 cross-brand deal | `deals` with multi-brand `valid_at_restaurant_ids` |
| Commerce as driver of loyalty signup | 20% of new members originate from commerce flow | `members.source='commerce'` distribution |
| VIP early-access uptake | VIP conversion rate ≥2x public conversion rate | segment-attributed analytics |

### Business Metrics

| Metric | Target | How Measured |
|--------|--------|-------------|
| ARPU uplift from commerce tier adoption | +30% across all paying tiers | billing data |
| Commerce tier churn | <4% monthly | subscription events |
| Net GMV processed (total platform) | HK$5M / month by month 6 | aggregate |

---

## 15. Risks and Mitigations

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|-----------|
| R1 | HK Consumer Council issues stronger guidance / regulation on prepaid vouchers during MVP | Medium | High | Mandatory 7-day refund + 30-day grace period is more generous than likely regulation. Monitor Consumer Council publications monthly. Have legal review T&C template before launch. |
| R2 | Payment webhook reliability — missed webhook means paid diner has no coupon | Low | High | Idempotent handlers. Nightly reconciliation job. In-app "my purchases" page lets diner re-trigger coupon delivery if missing. Stripe retries webhooks for 3 days automatically. |
| R3 | Inventory oversell from race condition | Low | High | Row-level lock in `reserve_deal_inventory`. Serializable isolation at the deal row. Unit tests with concurrent transaction simulation. |
| R4 | Merchant bankruptcy — diner loses money | Medium | High (reputational) | Bankruptcy disclosure in every T&C. 30-day grace period at cost. Sister-brand honor for Model B/C groups. Stripe chargeback available for card-paid vouchers. |
| R5 | Fraud: bulk bot purchasing flash sales to resell | Medium | Medium | Rate limits per phone, per deal. Phone verification for new members. CAPTCHA on burst patterns. Manual review for deals >100 units sold in <1 minute. |
| R6 | **Merchant payment onboarding abandonment** — many HK restaurants stall mid-Stripe KYC (document collection, BR confirmation, bank verification) | **High** | **High** | Allow deals to be created in `draft` state pre-Stripe so merchants see the end product; show clear onboarding progress bar; **white-glove onboarding for pilot merchants** (PM/CS walks them through live); email nudges at 24h, 72h, 7d after abandonment; "Resume Stripe Setup" CTA re-issues fresh account links (Stripe links expire in 7 days). |
| R7 | **Application fee disclosure / merchant acceptance** — merchants may feel surprised by the platform fee on settlement reports | Medium | Medium | **Transparent disclosure in merchant T&C at signup** — explicit rate, example calculation. Per-deal and per-payout breakdown in merchant dashboard ("Gross / Fee / Net"). Early-adopter rate lock guarantees for pilot cohort. Consumer-facing checkout does not need to disclose the fee since merchant sets face value and sale price. |
| R8 | **PayMe / FPS reconciliation complexity (Phase 2)** — no native split payment, commission collected via monthly invoice introduces credit risk and merchant-dispute surface | High | Medium | Require a Stripe account on file for every merchant even if PayMe/FPS is their primary channel, so we can auto-charge unpaid platform invoices to the Stripe account. 30-day invoice terms. Monthly commission reporting in merchant dashboard. Legal review of invoice terms before Phase 2 launch. |
| R9 | Stripe Connect payout delays cause merchant cash flow complaints | Low | Medium | Onboarding docs explain Stripe 2-7 day payout cycles (standard for new accounts). Merchants with cash-flow sensitivity pointed to PayMe (instant) as Phase 2 alternative. |
| R10 | WhatsApp template rejection from Meta for commerce CTAs | Medium | Medium | Submit templates 2 weeks before launch. Follow Meta commerce template guidelines strictly. Plain-text fallback for each marketing template. |
| R11 | Chargeback liability — Stripe refunds diner; we already issued coupon redeemed | Medium | Medium | On `charge.dispute.created` webhook, auto-void coupon even if already redeemed (rare edge). Merchant sees the chargeback in Stripe dashboard and can dispute via Stripe. Clear merchant education. |
| R12 | Merchant floods members with too many flash sale broadcasts → unsubscribes | High | Medium | Platform-enforced cooldown: no more than 3 marketing broadcasts per member per week per restaurant. Unsubscribe rate alerting at 2% threshold. |
| R13 | Competitor (SleekFlow / Omnichat) ships similar commerce in F&B vertical during MVP | Medium | Medium | First-mover in loyalty+commerce+POS intersection matters. Ship MVP in 10 weeks. Lean on cross-brand + guided merchant onboarding as differentiators. |
| R14 | Diner confusion — WhatsApp Pay vs payment link creates friction | Medium | Low | Single CTA flow. Stripe-branded checkout is obvious. Measure drop-off between card view and payment link tap; iterate on card copy. |
| R15 | **`PaymentGatewayPort` abstraction leak** — Stripe-only MVP bakes Stripe-specific assumptions into domain/use cases; future adapters (PayMe, FPS, KPay, bbMSL) require refactoring instead of addition | Medium | Medium (compounds over time) | Enforce port-first design in code review; **write the port interface BEFORE the Stripe adapter**; even in MVP, ship one stub adapter (e.g., `TestPaymentGatewayAdapter`) to prove the port is not Stripe-coupled; code review checklist item flags any Stripe-specific leak (e.g., `application_fee_amount` appearing outside `StripeAdapter`). |

---

## 16. Phased Delivery Plan

### Phase 1: Commerce MVP (10 weeks)

**Goal**: Ship the minimum viable marketplace flash-sale and voucher-sale experience for single-brand restaurants on Stripe Connect Standard — including guided merchant payment onboarding.

| Week | Deliverable |
|------|------------|
| 1-2 | Data model migrations: `deals`, `payment_intents` (with `platform_fee_*` columns), `merchant_payment_accounts`, `coupons` column additions, event type extensions, Postgres functions. RLS policies. Domain entities and repositories. |
| 2-3 | **Stripe Connect Standard onboarding UI** — create account, generate account link, handle `account.updated` webhook, status tracking, "Resume Setup" flow. Platform application fee configuration (platform default, per-merchant override). |
| 3-4 | Deal management API (create, update, launch, cancel, analytics). Deal management UI in dashboard. T&C auto-generation. Gate `launch` behind `merchant_payment_accounts.status='active'`. |
| 4-5 | Purchase intent API (diner-facing). Inventory reservation with `reserve_deal_inventory`. Reservation expiry sweep job. PaymentIntent creation on connected account with `application_fee_amount`. |
| 5-6 | Stripe webhook handlers (for connected accounts). Coupon issuance on payment success. `platform_fee_amount` persistence. WhatsApp utility template delivery. Purchase points awarding. |
| 6-7 | POS redemption of `purchased` coupons (extend existing use case). Redemption confirmation utility message. |
| 7-8 | Refund API and UI. Coupon voiding, points reversal, Stripe refund with `refund_application_fee=true` (proportional platform fee refund). Refund confirmation utility message. |
| 8-9 | Deal analytics dashboard (Gross / Fee / Net per deal). Platform admin commerce revenue dashboard. Expiry reminder jobs (7d, 1d templates). WhatsApp marketing broadcast flow for deals. |
| 9-10 | End-to-end testing. Legal review of T&C (including platform fee disclosure). Security review of payment handlers. Bug fixes. **Pilot merchant white-glove onboarding dry run.** |

**Phase 1 Exit Criteria:**
- Merchant can complete Stripe Connect Standard onboarding inside our dashboard.
- Merchant can create, launch, and cancel deals.
- Diner can buy a voucher via WhatsApp through Stripe (Stripe-only in MVP; PayMe/FPS Phase 2).
- Coupon delivered within 60 seconds of payment success.
- Platform application fee collected on every transaction via `application_fee_amount`.
- POS redemption works end-to-end.
- Merchant can refund unredeemed coupons (with proportional platform fee refund).
- Mandatory 7-day refund + 30-day grace period enforced.
- Deal analytics + platform revenue analytics visible.

**Decisions deferred to end of Phase 1 (post-pilot data):**
- Final **commerce SaaS tier pricing**.
- Final **platform application fee rate** (starting default: pick a reasonable number within 2-5% target band for pilot; lock in rate after 30-60 days of pilot data).

### Phase 2: Commerce Complete (8 weeks)

**Goal**: PayMe + FPS merchant onboarding, cross-brand bundles, catalog sync, VIP early access, and operational maturity.

| Week | Deliverable |
|------|------------|
| 11-12 | **PayMe for Business guided onboarding flow** (application links, document checklist, credential entry, test call). VIP early access segmentation. VIP-specific marketing template. |
| 12-13 | **FPS configuration wizard** (identifier entry, QR generation). Merchant-confirm reconciliation flow. Monthly commission invoicing ledger (for PayMe/FPS transactions). WhatsApp Catalog sync via Meta Graph API. |
| 13-14 | Cross-brand voucher bundles for Model B/C groups. Group-scoped deal creation. Valid-at-restaurant enforcement at redemption. |
| 14-15 | Points-as-payment for partial or full checkout. Bonus points multiplier on redemption. |
| 15-16 | Gift vouchers (buy for another phone). Waitlist on sellout. Deal scheduling UI improvements. |
| 17-18 | Automated FPS webhook via HSBC/BEA/HangSeng where available. Cross-brand analytics. Advanced fraud detection. Auto-charge Stripe on unpaid PayMe/FPS commission invoices. |

**Phase 2 Exit Criteria:**
- PayMe for Business guided onboarding live.
- FPS configuration wizard live with merchant-confirm reconciliation.
- Monthly commission invoicing operational for PayMe/FPS transactions.
- Cross-brand bundles work for Model B/C groups.
- VIP early access demonstrably drives higher conversion than public sales.
- Catalog sync live for all active deals.
- Points-as-payment adopted by at least 20% of purchases.

### Phase 3: Post-MVP Expansion (6 weeks)

**Goal**: Subscriptions, group buys, in-chat payments readiness, and HK-native payment adapters.

| Week | Deliverable |
|------|------------|
| 19-20 | Recurring voucher subscriptions (monthly prepaid). Subscription lifecycle management. |
| 20-21 | Group buy minimum-quantity deals. Reservation + payment collection logic. |
| 21-22 | Enhanced platform-side merchant vetting (for marketplace quality — not a regulatory requirement). Fraud pattern detection maturity. |
| 22-23 | WhatsApp Payments native integration (when Meta launches in HK) — swap payment link flow for in-chat. |
| 23-24 | Deal recommendation engine (member-level ranking). |
| Roadmap (demand-triggered) | **KPay and bbMSL adapter development** (subject to merchant demand during pilot). Each adapter: 2-3 weeks engineering effort once the port is stable. Prioritization based on pilot merchant requests and existing merchant payment-gateway contracts. |

**Provider Adapter Onboarding SLA**: Once `PaymentGatewayPort` is stable after MVP, any new provider ships in **2-3 weeks** — adapter implementation, onboarding UI, commission-collection path. No domain or use-case changes required.

---

## 17. Non-Goals and Out of Scope

### MVP Payment Provider Scope

> **MVP supports only Stripe.** PayMe, FPS, KPay, bbMSL, and other providers are **architected-for** (via `PaymentGatewayPort`) but **not shipped in MVP**. PayMe and FPS are Phase 2; KPay and bbMSL are Phase 3+ on merchant demand.

### Explicitly NOT building in any phase:

| Item | Reason |
|------|--------|
| **Food delivery integration** | foodpanda/Deliveroo own this. Dine-in commerce is our lane. Integration in either direction is out of scope indefinitely. |
| **Menu-item-level ordering in chat** | "Order a bowl of ramen for pickup via WhatsApp" is order management, not voucher commerce. Different data model, different problem. |
| **Platform-held funds** | Stripe Connect Standard means funds settle directly to the merchant's Stripe balance. We are a marketplace orchestrator, not a payment facilitator. No SVF licensing required because we do not hold funds. |
| **In-chat native WhatsApp Payments** | Not yet available in HK. When Meta launches, we swap in (Phase 3). Not blocking MVP. |
| **Multi-currency support** | HK-only. HKD only. No conversion. |
| **Global expansion (SG, Taiwan, etc.)** | Phase 3 + at earliest. HK mid-market F&B underserved; win here first. |
| **Physical gift cards** | Plastic/paper gift cards as first-class product. Out of scope. Digital only. |
| **Referral rewards on voucher purchases** | "Invite a friend, both get 10% off this voucher" is adjacent but not MVP. Existing campaign system can approximate. |
| **A/B testing of deal copy/pricing** | Useful but not blocking. Phase 3 consideration. |
| **Dynamic pricing / surge pricing** | Not applicable to voucher sales. Flash sales have fixed prices. |
| **Reservations / table booking integration** | Adjacent problem, separate product surface. Not blending into commerce. |
| **OpenRice/Klook data import** | We are not migrating a customer's OpenRice voucher holders into our system. Out of scope. |
| **AI-generated deal copy / hero images** | Interesting; not blocking MVP. Phase 3 skill integration possible. |
| **Corporate / B2B bulk voucher sales** | A restaurant selling HK$50K of vouchers to a corporate HR team as employee perks. Different sales motion, invoicing, T&C. Out of scope. |
| **Gift card marketplace (diner buys from any restaurant, not just their members)** | We are building for the restaurant's existing member base. A public marketplace is a different product. |

### Deferred to future iterations:

| Item | When |
|------|------|
| Subscription vouchers ("coffee of the month") | Phase 3 |
| Group buy banquets | Phase 3 |
| Deal recommendation ML | Phase 3+, after usage data accumulates |
| Offline POS redemption tokens | Phase 2 if customer feedback demands |
| PayMe / FPS merchant onboarding | Phase 2 |
| KPay (Qfpay) and bbMSL (Global Payments) adapters | Phase 3+ — architected-for via `PaymentGatewayPort`, shipped on merchant demand |
| Merchant-to-merchant referral of commerce tier | After 100+ commerce restaurants live |

---

## Open Questions

| # | Question | Owner | Needed By |
|---|----------|-------|-----------|
| Q1 | For FPS, which HK bank partners will we prioritize for automated webhook reconciliation (HSBC, BEA, HangSeng)? Each has different API availability. | Engineering | Phase 2 Week 1 |
| Q2 | Merchant KYC depth: Stripe Connect Standard handles merchant KYC via Stripe's hosted onboarding. Do we add optional platform-side vetting (e.g., require uploaded BR + identity check in our own dashboard for marketplace quality signals)? Decision only needed if abuse patterns emerge post-launch. | PM + Legal | Post-MVP (review after first 30 days) |
| Q3 | How do we handle VAT/tax implications for voucher sales across HK? Most F&B vouchers are not VAT-relevant in HK (no GST), but confirm tax treatment of platform application fee revenue. | Legal + Biz | Phase 1 Week 6 |
| Q4 | Should the 7-day unconditional refund be communicated as "14-day" to align with EU/common global consumer law norms, or is 7-day sufficient per HK common practice? | PM | Phase 1 Week 2 |
| Q5 | Do we build a consumer-facing web receipt / voucher detail page (with QR) or keep everything in WhatsApp thread? Web page adds trust and is shareable; WhatsApp-only is simpler. | PM + UX | Phase 1 Week 3 |
| Q6 | What happens to purchased vouchers if a restaurant leaves the platform? We need a data export + continuity plan. | PM + Legal | Phase 1 Week 8 |

**Deferred (decisions intentionally postponed, not blocking MVP):**

- **Commerce SaaS tier pricing** — TBD, to be confirmed post-MVP launch based on early-adopter data. MVP ships with a platform-configured default.
- **Final application fee rate** — ships at a reasonable default within the 2-5% target band for pilot; final rate confirmed after 30-60 days of live data.
- **Stripe Connect account type** — resolved: **Standard**.

---

## Appendix A: Glossary

| Term | Definition |
|------|-----------|
| **Deal** | A voucher template. Defines price, face value, inventory, sale window, redemption expiry. Issues N coupons upon purchase. |
| **Coupon** | A single issued instance of a deal, bound to a member. Redeemable at POS. |
| **Flash Sale** | A deal with a short sale window and limited inventory designed to drive urgency. |
| **Face Value** | What the voucher is worth at redemption (e.g., HK$200 off a check). |
| **Purchase Price** | What the diner paid for the voucher (e.g., HK$160 for a HK$200 face value). |
| **Grace Period** | 30 days after primary expiry during which a voucher can be redeemed at its purchase price (not face value). Mandatory platform policy. |
| **Payment Intent** | A reservation of inventory + pending payment. Expires after 10 minutes if not paid. |
| **Stripe Connect Standard** | Stripe account model where the merchant has a fully-independent Stripe account and is the merchant-of-record. Platform charges an application fee per transaction via `application_fee_amount`. |
| **Application Fee** | The platform commission collected on each transaction via Stripe's `application_fee_amount` parameter. Specified in cents on the PaymentIntent; deducted before merchant payout. |
| **Marketplace Orchestrator** | OhMyClient's role — we facilitate the commerce contract, collect commission, and deliver the customer experience, while the merchant handles settlement/disputes/tax via Stripe. |
| **VIP Early Access** | Pre-public-launch window during which only a specified member segment can purchase. |
| **`PaymentGatewayPort`** | Domain interface that every payment provider adapter implements. Enables Stripe, PayMe, FPS, KPay, bbMSL, and future providers to be added without changes to domain entities or use cases. Hexagonal / ports-and-adapters pattern. |
| **Payment Provider Adapter** | A concrete implementation of `PaymentGatewayPort` for a specific provider (e.g., `StripeAdapter`, `KPayAdapter`). Encapsulates provider-specific API calls, webhook handling, and commission-collection strategy. |
| **Commission Strategy** | How the platform collects its fee from a given provider. One of: `native_application_fee` (Stripe — taken at the gateway), `monthly_invoice` (PayMe/FPS/KPay/bbMSL — platform bills merchant monthly), `revenue_share` (reserved for future bespoke arrangements). |

## Appendix B: Related System Context

| System Component | Current State | File / Migration |
|-----------------|--------------|-----------------|
| Coupon entity | `type` check includes campaign/reward/manual; `status`, `code`, `expires_at`, `discount_type`, `discount_value`, `max_uses`, `current_uses`, `is_active` | `src/domain/entities/coupon.ts`, coupon migrations |
| Reward catalog | Per-restaurant points-redeemable templates. Issues coupons on redemption. | `src/domain/entities/reward.ts`, `redeem-reward.ts`, `010_rewards_catalog.sql` |
| Coupon redemption ledger | `coupon_redemptions` with POS transaction linkage | coupon redemption migrations |
| Atomic coupon use counters | `increment_coupon_uses`, `decrement_coupon_uses` | SQL functions |
| Event system | BullMQ fan-out, source-based echo prevention | `src/application/emit-event.ts` |
| Member points | `members.points_balance`, `adjust_member_points()` | `022_adjust_member_points.sql` |
| POS integration | Per-restaurant, HMAC webhook auth | `src/domain/entities/pos-integration.ts`, `020_pos_integration.sql` |
| WhatsApp BSP | Kapso-backed `WhatsAppMessagingPort`, `sendTextMessage`, `sendImageMessage`, `uploadCouponQr` | `src/infrastructure/whatsapp/*` |
| Multi-brand groups | `restaurant_groups`, `group_customers`, `loyalty_model`, `points_portability` | `docs/prd/multi-brand-loyalty-system.md` |
| Tenant plans | `starter`/`growth`/`pro` — commerce gated to `growth`+ | `017_tenant_plan.sql` |
| Member segments | Used for VIP early access gating | existing segmentation feature |
