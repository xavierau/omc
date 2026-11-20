# PRD: Multi-Brand Loyalty System

**Product**: OhMyClient (WhatsApp CRM for HK Restaurants)
**Author**: Product Manager
**Date**: 2026-04-15
**Status**: Draft — Awaiting VP-Engineering Approval
**Version**: 1.0

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [User Personas](#2-user-personas)
3. [Jobs to Be Done](#3-jobs-to-be-done)
4. [Feature Scope by Model](#4-feature-scope-by-model)
5. [User Stories with Acceptance Criteria](#5-user-stories-with-acceptance-criteria)
6. [Data Model Changes](#6-data-model-changes)
7. [API Contracts](#7-api-contracts)
8. [Event System Integration](#8-event-system-integration)
9. [WhatsApp Integration](#9-whatsapp-integration)
10. [POS Integration](#10-pos-integration)
11. [Privacy and Consent](#11-privacy-and-consent)
12. [Migration Paths](#12-migration-paths)
13. [Success Metrics](#13-success-metrics)
14. [Risks and Mitigations](#14-risks-and-mitigations)
15. [Phased Delivery Plan](#15-phased-delivery-plan)
16. [Non-Goals and Out of Scope](#16-non-goals-and-out-of-scope)

---

## 1. Executive Summary

### Problem

Restaurant group owners in Hong Kong commonly operate multiple brands across different cuisines (e.g., a sushi bar, an Italian trattoria, and a cha chaan teng under one ownership entity). Today, OhMyClient treats each restaurant as a fully isolated tenant. Owners managing 3-5 brands must log into each separately, cannot recognize shared customers, and miss cross-selling opportunities. Meanwhile, their customers carry separate memberships at each brand with no connection between them.

HK's multi-brand restaurant groups (Maxim's, Tsui Wah, Cafe de Coral Holdings) demonstrate that cross-brand loyalty drives measurable increases in visit frequency. Coalition programs like Yuu Rewards capture this value but force restaurants to surrender data ownership and brand identity. There is an unserved mid-market segment: independent multi-brand owners (2-10 shops) who want cross-brand benefits with full data ownership.

### Solution

Introduce three loyalty models that restaurant groups can adopt and progressively upgrade between:

- **Model A (Separate Brands)** — Already supported. Enhance with group-level dashboard rollup.
- **Model B (Cross-Recognition)** — Brands remain distinct but belong to a group. Customers are recognized across brands. Points are optionally portable. Each brand keeps its own WhatsApp number and identity.
- **Model C (Unified Program)** — One loyalty program, shared point pool, unified rewards. Locations are branches, not brands. Single WhatsApp channel.

Owners can start at A and upgrade to B or C as their business evolves, with data migration tooling at each step.

### Business Impact

| Metric | Expected Impact |
|--------|----------------|
| Average Revenue Per Group Owner | +40-60% (upsell from single-brand to group plan) |
| Customer Retention (group members) | +15-25% cross-brand visit frequency |
| Platform Stickiness | High switching cost once cross-brand data flows |
| New Market Segment | Mid-market multi-brand groups (est. 200-500 groups in HK) |

---

## 2. User Personas

### Persona 1: Multi-Brand Owner ("Group Boss")

**Profile**: Owns 2-8 restaurants across 2-4 brands. Manages via a small operations team. Thinks in terms of portfolio performance, not individual shop metrics.

**Demographics**: Age 35-55, Cantonese-speaking, tech-comfortable but not technical. Uses WhatsApp Business for personal comms. Relies on operations manager for CRM.

**Pain Points**:
- Cannot see total customer base across brands
- Loyal customer at Brand X is treated as a stranger at Brand Y
- No way to cross-promote between brands
- Must configure campaigns, rewards, and POS separately per brand
- Billing is per-restaurant; wants group pricing

**Current Behavior**: Logs into each restaurant dashboard separately. Exports member lists to Excel for manual cross-referencing. Sends cross-brand promotions via personal WhatsApp broadcasts (untrackable).

### Persona 2: Single-Brand Owner ("Solo Owner")

**Profile**: Owns 1-2 locations of the same brand. May aspire to grow into multiple brands later.

**Pain Points**:
- Satisfied with current Model A behavior
- Would be confused or annoyed by group features cluttering the UI
- Needs assurance that adding a second brand later is easy

**Current Behavior**: Uses OhMyClient as designed today. Happy with single-tenant experience.

### Persona 3: End Customer ("Diner")

**Profile**: HK resident, age 20-50, dines out 3-5 times per week. Uses WhatsApp daily. Has 5-15 restaurant loyalty memberships across various apps and paper cards.

**Pain Points**:
- Too many loyalty programs to track
- Disappointed when points at one restaurant cannot be used at the owner's other restaurant
- Privacy-conscious; does not want personal data shared without consent
- Expects WhatsApp messages to come from the brand they know, not a generic group name

**Current Behavior**: Joins loyalty programs opportunistically (QR scan at table). Engages with WhatsApp campaigns that offer tangible rewards. Ignores generic marketing.

---

## 3. Jobs to Be Done

### Group Boss

| When... | I want to... | So I can... |
|---------|-------------|-------------|
| I open the dashboard | See all my brands' performance in one view | Make portfolio-level decisions without switching tenants |
| A loyal customer visits Brand X | Recognize them even if they originally joined at Brand Y | Provide VIP treatment that drives cross-brand visits |
| I run a promotion | Target customers across brands based on combined behavior | Maximize campaign ROI by leveraging my full customer base |
| I set up loyalty rules | Configure whether points are shared, portable, or separate per brand | Match the loyalty model to my business strategy |
| I add a new brand | Onboard it into my existing group with minimal setup | Start benefiting from cross-brand recognition immediately |

### Solo Owner

| When... | I want to... | So I can... |
|---------|-------------|-------------|
| I consider adding a second brand | See an easy path to connect them later | Feel confident OhMyClient scales with my business |
| I use the dashboard | See only my restaurant's data without group clutter | Stay focused on my single brand |

### Diner

| When... | I want to... | So I can... |
|---------|-------------|-------------|
| I visit a new restaurant in the same group | Be recognized without re-registering | Skip the signup friction and feel valued |
| I earn points at Brand X | Optionally use them at Brand Y | Get more flexibility in how I redeem rewards |
| My data is shared across brands | Have given explicit consent first | Trust the program and feel in control |
| I receive a WhatsApp message | See it from the brand I know | Not be confused by messages from an unfamiliar group name |

---

## 4. Feature Scope by Model

### Model A Enhancements (Separate Brands)

| Feature | Description | Priority |
|---------|-------------|----------|
| Group Dashboard Rollup | Aggregate KPIs across restaurants the owner manages | P1 |
| Bulk Operations | Apply settings, create campaigns across multiple restaurants | P2 |
| Group-Level Billing | Single invoice for all restaurants in a group | P2 |

No data model changes required for existing tenants. Uses existing `user_tenants` M:N relationship.

### Model B (Cross-Recognition)

| Feature | Description | Priority |
|---------|-------------|----------|
| Restaurant Groups | Create and manage groups of restaurants | P0 |
| Group Customer Identity | Match customers across brands by phone number | P0 |
| Cross-Brand Customer Profile | View a customer's activity across all group brands | P0 |
| Points Portability Config | Per-group toggle: isolated, portable, or pooled points | P0 |
| Points Transfer API | Transfer points between brands within a group | P1 |
| Cross-Brand Reward Visibility | Show rewards from sibling brands to members | P1 |
| Group Campaigns | Target members across group brands | P1 |
| Cross-Brand WhatsApp Templates | "Also visit our sister brand" messaging | P1 |
| Group Analytics Dashboard | Cross-brand metrics, overlap analysis, flow reports | P1 |
| Cross-Brand Consent Layer | PDPO-compliant opt-in for data sharing | P0 |
| POS Cross-Brand Point Routing | POS webhook routes points to correct brand/pool | P1 |
| Group Member Segments | Segment by cross-brand behavior | P2 |

### Model C (Unified Program)

| Feature | Description | Priority |
|---------|-------------|----------|
| Unified Member Identity | Single member record across all locations | P0 |
| Shared Point Pool | One balance, earn/spend at any location | P0 |
| Unified Reward Catalog | Rewards available at all/specific locations | P0 |
| Location-Aware Events | Events tagged with location, not restaurant | P0 |
| Single WhatsApp Channel | One WABA number for the entire program | P1 |
| Location Selector in Messages | "Visit us at [Causeway Bay / Tsim Sha Tsui / ...]" | P1 |
| B-to-C Migration Tooling | Merge separate member records, consolidate points | P0 |

---

## 5. User Stories with Acceptance Criteria

### 5.1 Model B: Restaurant Groups

#### B-01: Create a Restaurant Group

**As a** multi-brand owner
**I want to** create a restaurant group and add my existing restaurants to it
**So that** I can manage them as a portfolio

**Acceptance Criteria:**
- [ ] Given I own 2+ restaurants (via `user_tenants`), when I navigate to Group Settings, then I can create a new group with a name and optional logo
- [ ] Given I am creating a group, when I select restaurants to include, then only restaurants where I have `admin` role appear as options
- [ ] Given a group is created, when I view my navigation, then I see a group-level dashboard option alongside individual brand dashboards
- [ ] Given a restaurant is already in a group, when another user tries to add it to a different group, then the system rejects with an error

**Out of Scope:**
- Group hierarchy (groups of groups)
- Transferring restaurant ownership between groups

---

#### B-02: Configure Points Portability

**As a** group owner
**I want to** choose how points work across my brands
**So that** I can match the loyalty structure to my business model

**Acceptance Criteria:**
- [ ] Given I manage a group, when I open Group Loyalty Settings, then I see three options: (a) Isolated — points stay per-brand, (b) Portable — earn per-brand, spend anywhere in group, (c) Pooled — single balance across all brands
- [ ] Given I select "Portable," when a member earns 100 pts at Brand X, then their Brand X balance increases by 100 and they can choose to spend from Brand X or Brand Y balance when redeeming
- [ ] Given I select "Pooled," when a member earns 100 pts at Brand X, then their group-level pool increases by 100 and any brand in the group can deduct from it
- [ ] Given I change portability mode from Isolated to Portable, when the change takes effect, then existing per-brand balances are preserved; no points are merged or lost
- [ ] Given I attempt to change from Portable to Isolated, when I confirm, then the system warns that members will lose cross-brand spending ability and requires explicit confirmation

**Notes:**
- "Pooled" in Model B is a stepping stone toward Model C. The difference: in Model B pooled mode, member records are still per-brand; in Model C, the member record itself is unified.
- Exchange rates between brands are out of scope for Phase 1. 1:1 parity assumed.

---

#### B-03: Cross-Brand Customer Recognition

**As a** group owner
**I want to** automatically recognize when a customer at Brand X is already a member at Brand Y
**So that** I can provide a connected experience without manual data entry

**Acceptance Criteria:**
- [ ] Given a customer with phone +852-9XXX-XXXX is a member at Brand X (in the same group), when they join Brand Y, then the system creates a `group_customers` link connecting both member records
- [ ] Given a linked customer visits Brand Y, when staff views their profile, then they see a "Also a member at: Brand X" indicator with basic stats (join date, points balance at Brand X) — only if the customer has consented to cross-brand sharing
- [ ] Given a customer has NOT consented to cross-brand data sharing, when they join Brand Y, then the `group_customers` link is created but Brand Y staff see NO data from Brand X
- [ ] Given a customer is recognized across brands, when I view them in the group dashboard, then I see a unified profile with all brand memberships listed

**Notes:**
- Matching is strictly by phone number (E.164 format). No fuzzy matching.
- The `group_customers` record is created at join time via a Postgres trigger or application-level hook in `register-member`.

---

#### B-04: Cross-Brand Consent Management

**As a** diner
**I want to** control whether my data is shared across brands in a group
**So that** I feel safe and maintain trust in the loyalty program

**Acceptance Criteria:**
- [ ] Given I join Brand Y and am recognized as an existing Brand X member, when I complete registration, then I receive a WhatsApp message asking: "Brand X and Brand Y are part of [Group Name]. Would you like to share your membership across both? Reply YES or NO."
- [ ] Given I reply YES, when the system processes my response, then my `group_customers.consent_status` is set to `granted` and both brands can see each other's data
- [ ] Given I reply NO, when the system processes my response, then my `group_customers.consent_status` remains `pending` (treated as denied) and brands cannot see each other's data
- [ ] Given I previously granted consent, when I message "STOP SHARING" to any brand in the group, then my consent is revoked and cross-brand visibility is disabled
- [ ] Given consent status changes, when the change is processed, then an event `cross_brand_consent` is emitted with the old and new status

**Notes:**
- PDPO (Personal Data (Privacy) Ordinance) requires explicit opt-in for sharing personal data with third parties. Even though the brands share an owner, they are legally separate data controllers unless structured otherwise.
- Default consent status is `pending` (= not granted). The system treats `pending` and `denied` identically for data visibility.

---

#### B-05: Points Transfer Between Brands

**As a** diner with portable points
**I want to** spend points earned at Brand X when redeeming a reward at Brand Y
**So that** I get maximum value from my loyalty across the group

**Acceptance Criteria:**
- [ ] Given the group has points portability set to "Portable," when a member at Brand Y tries to redeem a 200-point reward but only has 50 points at Brand Y, then the system shows available balances across all group brands (e.g., Brand X: 300, Brand Y: 50)
- [ ] Given the member selects to use 150 points from Brand X and 50 from Brand Y, when the redemption is confirmed, then `adjust_member_points` is called for both member records atomically (within a single Postgres transaction)
- [ ] Given a points transfer occurs, when the transaction completes, then a `points_transfer` event is emitted at both the source and destination brands with a shared `transfer_id`
- [ ] Given the group has points portability set to "Isolated," when a member tries to redeem at Brand Y, then only Brand Y points are shown; no cross-brand option appears
- [ ] Given a points transfer fails mid-transaction (e.g., insufficient balance after race condition check), when the error occurs, then both adjustments are rolled back and the member is notified

**Notes:**
- Atomicity is critical. The existing `adjust_member_points` Postgres function operates on a single member. A new function `transfer_points_across_brands` must wrap two calls in a single transaction with `FOR UPDATE` locks on both rows.

---

#### B-06: Group-Level Campaign

**As a** group owner
**I want to** send a campaign to members across all my brands
**So that** I can promote cross-brand offers (e.g., "Show this coupon at any of our restaurants")

**Acceptance Criteria:**
- [ ] Given I create a campaign at the group level, when I select the audience, then I can target: (a) all group members, (b) members of specific brands, (c) members who have ONLY visited one brand (cross-sell targets)
- [ ] Given a group campaign targets members across brands, when the campaign sends, then each member receives the message from the WhatsApp number of the brand they originally joined (their "home brand")
- [ ] Given a group campaign includes a coupon, when the coupon is generated, then the coupon is redeemable at any brand in the group (unless restricted to specific brands)
- [ ] Given a group campaign is executed, when I view results, then I see per-brand breakdowns of sends, opens, and redemptions alongside group totals
- [ ] Given a member has not consented to cross-brand data sharing, when a group campaign is sent, then they receive the campaign only if the campaign specifically targets their home brand

**Notes:**
- Group campaigns are stored in a new `group_campaigns` table, not in the existing per-restaurant `campaigns` table. This avoids schema contamination.
- The WhatsApp template must be approved for each brand's WABA number separately. The campaign creation flow must handle multi-WABA template submission.

---

#### B-07: Group Analytics Dashboard

**As a** group owner
**I want to** see cross-brand analytics on a single dashboard
**So that** I can understand customer overlap, flow patterns, and portfolio performance

**Acceptance Criteria:**
- [ ] Given I open the group dashboard, when it loads, then I see: total group members, unique customers (deduplicated by phone), cross-brand overlap percentage, total points outstanding, combined revenue (from POS)
- [ ] Given I view the overlap analysis, when I select two brands, then I see: shared customer count, average spend at each brand, direction of flow (Brand X members who later joined Brand Y vs. vice versa)
- [ ] Given I view the time series, when I select a date range, then I see new member registrations, points issued, and redemptions broken down by brand with a group total line
- [ ] Given I export the report, when I click Export, then a CSV is generated with one row per customer showing all brand memberships and combined metrics

---

### 5.2 Model C: Unified Program

#### C-01: Unified Member Identity

**As a** group owner who has adopted Model C
**I want to** have a single member record per customer across all locations
**So that** the customer has one identity, one balance, one history

**Acceptance Criteria:**
- [ ] Given a group upgrades from Model B to Model C, when the migration runs, then all `group_customers` linked records are merged into a single member record per unique phone number
- [ ] Given a merged member, when I view their profile, then I see combined points balance (sum of all brand balances), full transaction history from all locations, and unified reward eligibility
- [ ] Given a new customer joins at any location after Model C is active, when they register, then a single member record is created at the group level (not per-restaurant)
- [ ] Given the unified member earns points at Location A, when they check their balance at Location B, then the balance reflects the earning immediately (same record, no sync needed)

**Notes:**
- The `members` table constraint `UNIQUE(restaurant_id, phone)` must be relaxed for Model C groups. A new `group_id` column on `members` is used instead, with `UNIQUE(group_id, phone)` for Model C members.
- Historical member records from individual restaurants are soft-deleted (archived) with a pointer to the new unified record.

---

#### C-02: Unified Reward Catalog

**As a** group owner on Model C
**I want to** manage one reward catalog with optional location restrictions
**So that** customers see a consistent set of rewards regardless of which location they visit

**Acceptance Criteria:**
- [ ] Given I am on Model C, when I create a reward, then I can assign it to "all locations" or restrict it to specific locations
- [ ] Given a reward is restricted to Location A, when a customer at Location B views rewards, then they see the reward marked as "Available at [Location A] only"
- [ ] Given a customer redeems a location-restricted reward, when the coupon is generated, then the coupon is only valid at the specified locations

---

### 5.3 Model A Enhancements

#### A-01: Group Dashboard Rollup (Model A)

**As a** restaurant owner managing multiple independent restaurants
**I want to** see an aggregated view of all my restaurants
**So that** I can compare performance without switching between dashboards

**Acceptance Criteria:**
- [ ] Given I manage 3 restaurants via `user_tenants`, when I navigate to "My Portfolio," then I see a table with each restaurant's member count, active coupons, points outstanding, and 30-day revenue
- [ ] Given I view the portfolio, when I click a restaurant row, then I navigate to that restaurant's individual dashboard
- [ ] Given I manage only 1 restaurant, when I log in, then the portfolio view is hidden; I go directly to the restaurant dashboard

---

## 6. Data Model Changes

### 6.1 New Tables

#### `restaurant_groups`

```sql
CREATE TABLE restaurant_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  logo_url TEXT,
  loyalty_model TEXT NOT NULL DEFAULT 'separate'
    CHECK (loyalty_model IN ('separate', 'cross_recognition', 'unified')),
  points_portability TEXT NOT NULL DEFAULT 'isolated'
    CHECK (points_portability IN ('isolated', 'portable', 'pooled')),
  created_by UUID NOT NULL,  -- user_id of the creating owner
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Notes:**
- `loyalty_model` maps to Model A/B/C. `separate` = A, `cross_recognition` = B, `unified` = C.
- `points_portability` only applies when `loyalty_model` = `cross_recognition`. For `unified`, points are always pooled.

#### `restaurant_group_members` (group-restaurant junction)

```sql
CREATE TABLE restaurant_group_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES restaurant_groups(id) ON DELETE CASCADE,
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(restaurant_id)  -- a restaurant belongs to at most one group
);
CREATE INDEX idx_rgm_group ON restaurant_group_members(group_id);
```

**Notes:**
- `UNIQUE(restaurant_id)` enforces the constraint that a restaurant can only be in one group.

#### `group_customers` (cross-brand identity link)

```sql
CREATE TABLE group_customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES restaurant_groups(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,  -- E.164 normalized
  consent_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (consent_status IN ('pending', 'granted', 'denied', 'revoked')),
  consent_updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(group_id, phone)
);
CREATE INDEX idx_gc_phone ON group_customers(phone);
```

**Notes:**
- This table links a phone number to a group. Individual `members` records at each restaurant reference this via `group_customer_id` (new FK column on `members`).
- `pending` and `denied` are treated identically for access control. `revoked` is a terminal state from a previously `granted` consent.

#### `points_transfers` (cross-brand points movement ledger)

```sql
CREATE TABLE points_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES restaurant_groups(id),
  source_member_id UUID NOT NULL REFERENCES members(id),
  target_member_id UUID NOT NULL REFERENCES members(id),
  amount INTEGER NOT NULL CHECK (amount > 0),
  reason TEXT NOT NULL DEFAULT 'redemption',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_pt_group ON points_transfers(group_id);
CREATE INDEX idx_pt_source ON points_transfers(source_member_id);
CREATE INDEX idx_pt_target ON points_transfers(target_member_id);
```

#### `group_campaigns`

```sql
CREATE TABLE group_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES restaurant_groups(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('cross_sell', 'group_promo', 'winback', 'announcement')),
  target_scope TEXT NOT NULL DEFAULT 'all'
    CHECK (target_scope IN ('all', 'specific_brands', 'single_brand_only')),
  target_restaurant_ids UUID[] DEFAULT '{}',
  whatsapp_template_id TEXT,
  coupon_config JSONB,
  coupon_valid_at UUID[] DEFAULT '{}',  -- empty = all brands
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'sending', 'paused', 'completed')),
  sent_count INTEGER NOT NULL DEFAULT 0,
  redeemed_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_group_campaigns_group ON group_campaigns(group_id);
```

### 6.2 Modified Tables

#### `members` — Add group linkage

```sql
ALTER TABLE members ADD COLUMN group_customer_id UUID
  REFERENCES group_customers(id) ON DELETE SET NULL;
CREATE INDEX idx_members_group_customer ON members(group_customer_id);
```

#### `restaurants` — Add group membership reference

```sql
-- No column added to restaurants directly.
-- Group membership is via restaurant_group_members junction table.
-- This avoids modifying the heavily-referenced restaurants table.
```

#### `events` — Add new event types

```sql
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_type_check;
ALTER TABLE events ADD CONSTRAINT events_type_check
  CHECK (type IN (
    'join', 'redeem', 'receipt', 'campaign', 'points',
    'unsubscribe', 'reward_redeem',
    'pos_transaction', 'pos_refund', 'pos_customer_link',
    'integration_error',
    -- New cross-brand event types
    'cross_brand_recognition', 'cross_brand_consent',
    'points_transfer', 'group_campaign'
  ));
```

#### `rewards` — Add group-level fields (Model C)

```sql
ALTER TABLE rewards ADD COLUMN group_id UUID
  REFERENCES restaurant_groups(id) ON DELETE SET NULL;
ALTER TABLE rewards ADD COLUMN available_at_restaurant_ids UUID[] DEFAULT NULL;
-- NULL = available everywhere (or at the owning restaurant in Model A/B)
-- Non-null array = restricted to listed locations (Model C)
```

### 6.3 New Postgres Functions

#### `transfer_points_across_brands`

```sql
CREATE OR REPLACE FUNCTION transfer_points_across_brands(
  p_source_member_id UUID,
  p_target_member_id UUID,
  p_amount INTEGER,
  p_group_id UUID
) RETURNS UUID
LANGUAGE plpgsql AS $$
DECLARE
  v_source_balance INTEGER;
  v_transfer_id UUID;
BEGIN
  -- Lock both rows in consistent order (by UUID) to prevent deadlock
  IF p_source_member_id < p_target_member_id THEN
    SELECT points_balance INTO v_source_balance
      FROM members WHERE id = p_source_member_id FOR UPDATE;
    PERFORM 1 FROM members WHERE id = p_target_member_id FOR UPDATE;
  ELSE
    PERFORM 1 FROM members WHERE id = p_target_member_id FOR UPDATE;
    SELECT points_balance INTO v_source_balance
      FROM members WHERE id = p_source_member_id FOR UPDATE;
  END IF;

  IF v_source_balance < p_amount THEN
    RAISE EXCEPTION 'Insufficient points. Balance: %, requested: %',
      v_source_balance, p_amount;
  END IF;

  UPDATE members SET points_balance = points_balance - p_amount
    WHERE id = p_source_member_id;
  UPDATE members SET points_balance = points_balance + p_amount
    WHERE id = p_target_member_id;

  INSERT INTO points_transfers (group_id, source_member_id, target_member_id, amount)
    VALUES (p_group_id, p_source_member_id, p_target_member_id, p_amount)
    RETURNING id INTO v_transfer_id;

  RETURN v_transfer_id;
END;
$$;
```

### 6.4 RLS Policies

New tables require RLS policies following the existing pattern. Key addition: `user_group_ids()` helper function.

```sql
CREATE OR REPLACE FUNCTION user_group_ids()
RETURNS SETOF UUID AS $$
BEGIN
  RETURN QUERY
    SELECT rgm.group_id
    FROM restaurant_group_members rgm
    JOIN user_tenants ut ON ut.restaurant_id = rgm.restaurant_id
    WHERE ut.user_id = auth.uid();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;
```

All new tables (`restaurant_groups`, `restaurant_group_members`, `group_customers`, `points_transfers`, `group_campaigns`) get SELECT/INSERT/UPDATE policies using `user_group_ids()` and `is_platform_admin()`, following the same pattern as existing tables.

### 6.5 Entity Relationship Diagram (Text)

```
restaurant_groups (1) ──< restaurant_group_members >── (1) restaurants
       │
       │ (1)
       │
       ├──< group_customers (1) ──< members (via group_customer_id)
       │
       ├──< points_transfers
       │
       └──< group_campaigns
```

---

## 7. API Contracts

### 7.1 Group Management

#### `POST /api/dashboard/groups`
Create a new restaurant group.

```typescript
// Request
{
  name: string           // "Tasty Holdings"
  slug: string           // "tasty-holdings"
  restaurantIds: string[] // UUIDs of restaurants to include
}

// Response 201
{
  id: string
  name: string
  slug: string
  loyaltyModel: 'separate'
  pointsPortability: 'isolated'
  restaurants: { id: string; name: string }[]
  createdAt: string
}

// Errors
// 400: restaurantIds contains restaurant not owned by user
// 400: restaurant already belongs to another group
// 409: slug already taken
```

#### `PATCH /api/dashboard/groups/[groupId]`
Update group settings (name, loyalty model, points portability).

```typescript
// Request
{
  name?: string
  loyaltyModel?: 'separate' | 'cross_recognition' | 'unified'
  pointsPortability?: 'isolated' | 'portable' | 'pooled'
}

// Response 200: updated group object

// Errors
// 400: cannot downgrade loyaltyModel (C -> B or B -> A)
// 400: invalid portability for current loyalty model
```

#### `POST /api/dashboard/groups/[groupId]/restaurants`
Add a restaurant to an existing group.

```typescript
// Request
{ restaurantId: string }

// Response 201: updated restaurant list

// Errors
// 400: restaurant already in another group
// 403: user does not have admin role on the restaurant
```

#### `DELETE /api/dashboard/groups/[groupId]/restaurants/[restaurantId]`
Remove a restaurant from a group.

```typescript
// Response 200
// Side effects: group_customers links for members only at this restaurant are preserved
//   but cross-brand visibility is disabled

// Errors
// 400: cannot remove last restaurant from group (delete group instead)
```

### 7.2 Cross-Brand Customer

#### `GET /api/dashboard/groups/[groupId]/customers`
List group customers with cross-brand profiles.

```typescript
// Query params
// ?page=1&limit=20&search=+852&brand=restaurantId

// Response 200
{
  customers: {
    groupCustomerId: string
    phone: string
    consentStatus: 'pending' | 'granted' | 'denied' | 'revoked'
    memberships: {
      restaurantId: string
      restaurantName: string
      memberId: string
      pointsBalance: number
      joinedAt: string
      lastVisitAt: string | null
    }[]
    totalPoints: number  // sum across brands (if consent granted)
  }[]
  total: number
  page: number
}
```

#### `GET /api/dashboard/groups/[groupId]/customers/[groupCustomerId]`
Detailed cross-brand customer profile.

```typescript
// Response 200
{
  groupCustomerId: string
  phone: string
  consentStatus: string
  memberships: { /* same as above, plus per-brand event history */ }[]
  recentEvents: CrmEvent[]  // merged timeline across brands
  pointsTransfers: PointsTransfer[]  // cross-brand movements
}
```

### 7.3 Points Transfer

#### `POST /api/dashboard/groups/[groupId]/points/transfer`
Transfer points between brands for a customer (used during redemption or manual adjustment).

```typescript
// Request
{
  groupCustomerId: string
  sourceMemberId: string   // member record at source brand
  targetMemberId: string   // member record at target brand
  amount: number           // positive integer
  reason: 'redemption' | 'manual_adjustment' | 'migration'
}

// Response 201
{
  transferId: string
  sourceBalance: number    // new balance at source
  targetBalance: number    // new balance at target
}

// Errors
// 400: amount <= 0
// 400: source and target are same member
// 400: members not in same group
// 400: group portability is 'isolated'
// 409: insufficient balance
```

### 7.4 Group Campaigns

#### `POST /api/dashboard/groups/[groupId]/campaigns`
Create a group-level campaign.

```typescript
// Request
{
  name: string
  type: 'cross_sell' | 'group_promo' | 'winback' | 'announcement'
  targetScope: 'all' | 'specific_brands' | 'single_brand_only'
  targetRestaurantIds?: string[]
  whatsappTemplateId?: string
  couponConfig?: {
    discountType: 'percentage' | 'fixed_amount'
    discountValue: number
    expiresInDays: number
    validAtRestaurantIds?: string[]  // empty = all brands
  }
}

// Response 201: group campaign object
```

#### `POST /api/dashboard/groups/[groupId]/campaigns/[campaignId]/execute`
Execute a group campaign (send messages).

```typescript
// Response 202: { jobId: string, estimatedRecipients: number }
```

### 7.5 Group Analytics

#### `GET /api/dashboard/groups/[groupId]/analytics`
Group-level analytics.

```typescript
// Query params: ?from=2026-01-01&to=2026-04-15

// Response 200
{
  totalUniqueCustomers: number
  totalMembers: number  // across all brands (may be > unique due to multi-brand)
  crossBrandOverlapPercent: number
  totalPointsOutstanding: number
  perBrand: {
    restaurantId: string
    restaurantName: string
    memberCount: number
    pointsOutstanding: number
    revenue30d: number
    newMembers30d: number
  }[]
  overlapMatrix: {
    brandA: string
    brandB: string
    sharedCustomers: number
  }[]
}
```

---

## 8. Event System Integration

### 8.1 New Event Types

| Event Type | Trigger | `dataJson` Payload |
|------------|---------|-------------------|
| `cross_brand_recognition` | Customer phone matched across brands at registration | `{ groupId, groupCustomerId, existingMemberId, newMemberId, matchedPhone }` |
| `cross_brand_consent` | Customer grants/denies/revokes data sharing consent | `{ groupId, groupCustomerId, oldStatus, newStatus }` |
| `points_transfer` | Points moved between brands | `{ groupId, transferId, sourceMemberId, targetMemberId, amount, reason }` |
| `group_campaign` | Group campaign sent to a member | `{ groupCampaignId, groupId, homeRestaurantId }` |

### 8.2 Event Dispatch Changes

The existing `emitEvent()` function is scoped to a single `restaurantId`. For cross-brand events, the approach is:

1. **Primary event** is emitted at the restaurant where the action occurred (e.g., the registration restaurant for `cross_brand_recognition`).
2. **Fan-out events** are emitted to sibling restaurants in the group when relevant (e.g., the other brand gets a `cross_brand_recognition` event too).

This preserves the existing `emitEvent` contract. A new application-level function handles the fan-out:

```typescript
// New: src/application/emit-group-event.ts
async function emitGroupEvent(params: {
  groupId: string
  originRestaurantId: string
  memberId: string | null
  type: EventType
  dataJson: Record<string, unknown>
  fanOutToSiblings: boolean  // if true, emit to all group restaurants
}): Promise<string[]>
```

### 8.3 Listener Resolution

The existing `resolveListenersForEvent` resolves listeners per restaurant. For group events:
- Listeners registered at the group level (new concept: `group_event_listeners` config) are resolved in addition to restaurant-level listeners.
- A new `tenant-listener-resolver` extension checks if the event's restaurant belongs to a group and includes group-level listeners.

### 8.4 Echo Loop Prevention

Cross-brand fan-out creates a risk of echo loops. Prevention:
- Fan-out events carry `source: 'group_fanout:{originEventId}'`.
- The existing source-based echo prevention in `resolveListenersForEvent` filters out listeners that would re-trigger the same fan-out.

---

## 9. WhatsApp Integration

### 9.1 Model B: Multi-WABA Strategy

In Model B, each brand retains its own WhatsApp Business Account (WABA) and phone number via Kapso. Cross-brand messaging follows these rules:

| Scenario | WhatsApp Number Used | Template Approval |
|----------|---------------------|-------------------|
| Member joins Brand X | Brand X number | Brand X WABA |
| Cross-brand consent request | Brand where recognition occurred | That brand's WABA |
| Group campaign to member | Member's "home brand" number | Each brand's WABA separately |
| Points transfer notification | Brand where redemption occurred | That brand's WABA |

**Key constraint**: WhatsApp messages must come from the brand the customer knows. A Sushi Ko member should never receive a message from Pasta House's number about their Sushi Ko account.

### 9.2 Template Requirements

New WhatsApp templates needed for Model B:

| Template Name | Purpose | Variables |
|---------------|---------|-----------|
| `cross_brand_welcome` | Notify existing member they were recognized at sibling brand | `{{group_name}}`, `{{new_brand_name}}`, `{{existing_brand_name}}` |
| `cross_brand_consent` | Request consent for data sharing | `{{group_name}}`, `{{brand_list}}` |
| `cross_brand_points_earned` | Notify member they earned points at a sibling brand | `{{brand_name}}`, `{{points}}`, `{{total_balance}}` |
| `group_promo` | Cross-brand promotional campaign | `{{group_name}}`, `{{offer_details}}`, `{{valid_brands}}` |

### 9.3 Model C: Single WABA

In Model C, all locations share one WABA and phone number. Messages include location context:
- "You earned 50 points at [Location Name]."
- "Your balance: 500 points. Redeem at any of our locations."

This simplifies template management but requires location-aware message composition.

### 9.4 Kapso BSP Adapter Changes

The existing `WhatsAppMessagingPort` interface is per-restaurant (uses `kapsoPhoneNumberId` from the restaurant). For Model B group campaigns:
- The campaign executor resolves each recipient's home brand `kapsoPhoneNumberId`.
- Messages are sent in batches per WABA to respect per-number rate limits.

No changes to the port interface; the calling code selects the correct restaurant context per message.

---

## 10. POS Integration

### 10.1 Current State

POS integrations are per-restaurant (`pos_integrations.restaurant_id`). Webhooks from POS systems hit `/api/webhooks/pos/[integrationId]` and are authenticated via HMAC-SHA256. Points are awarded to the member at that restaurant.

### 10.2 Cross-Brand POS (Model B)

When a POS transaction occurs at Brand X for a customer recognized across the group:

| Points Portability | POS Behavior |
|-------------------|-------------|
| Isolated | Points awarded only at Brand X. No cross-brand effect. |
| Portable | Points awarded at Brand X. Member can later spend at Brand Y. No immediate cross-brand action. |
| Pooled | Points awarded at Brand X member record. Group dashboard shows combined pool. |

No changes to POS webhook routing are needed for Model B. The POS webhook still targets a specific `pos_integration_id` tied to a restaurant. The cross-brand logic happens at the loyalty layer, not the POS layer.

### 10.3 Unified POS (Model C)

In Model C, POS transactions award points to the unified member record. The `pos_transactions` table gains a `location_id` field (nullable, used only in Model C) to track which location the transaction occurred at.

```sql
ALTER TABLE pos_transactions ADD COLUMN location_id UUID
  REFERENCES restaurants(id) ON DELETE SET NULL;
```

The unified member's single `points_balance` is updated directly. No transfer logic needed.

### 10.4 POS Customer Matching

The existing `link-pos-customer` use case matches POS customers to members by phone. In a group context:
- If a POS transaction arrives with a phone number that matches a member at a sibling brand but not at this brand, the system does NOT auto-create a member at this brand.
- Instead, it emits a `cross_brand_recognition` event and logs the match for the group owner to review.
- Auto-enrollment at the transacting brand can be enabled via group settings (`auto_enroll_on_pos_match: boolean`).

---

## 11. Privacy and Consent

### 11.1 PDPO Compliance Framework

Hong Kong's Personal Data (Privacy) Ordinance (PDPO) governs this feature. Key requirements:

| PDPO Principle | Application |
|---------------|-------------|
| **Data Collection Purpose** (DPP1) | Members are told at join time that their data may be shared within a restaurant group for loyalty purposes |
| **Consent** (DPP3) | Explicit opt-in required before cross-brand data sharing. No pre-checked boxes. WhatsApp reply-based consent. |
| **Data Access** (DPP6) | Members can request full data export including cross-brand data via WhatsApp command |
| **Data Retention** | Cross-brand links are retained for 24 months after last activity, then auto-archived |
| **Data Portability** | Members can request data deletion, which cascades to `group_customers` and revokes consent |

### 11.2 Consent States

```
[Join at Brand Y] -> [Phone matched in group] -> [Consent request sent]
                                                        |
                                                   YES / NO
                                                   /       \
                                              [granted]  [denied]
                                                  |
                                           [STOP SHARING]
                                                  |
                                             [revoked]
```

- `pending`: Default. No cross-brand data visible to staff.
- `granted`: Full cross-brand visibility and portability enabled.
- `denied`: Explicit refusal. Identical to `pending` for access control. Can be changed by member later.
- `revoked`: Previously granted, now withdrawn. System treats as `denied` but retains audit trail.

### 11.3 Data Visibility Rules

| Data Point | Without Consent | With Consent |
|-----------|----------------|-------------|
| Name | Hidden | Visible |
| Phone | Hidden | Visible |
| Points balance at other brands | Hidden | Visible |
| Visit history at other brands | Hidden | Visible |
| Existence of membership at other brands | "Member at 1 other brand" (no details) | Full details |
| Redemption history | Hidden | Visible |

### 11.4 Technical Implementation

- Consent check is enforced at the repository layer. The `GroupCustomerRepository.getProfile()` method filters fields based on `consent_status`.
- API responses never leak data that consent has not been granted for. The filtering is server-side, not client-side.
- Consent changes are logged as events for audit purposes.

---

## 12. Migration Paths

### 12.1 Model A to Model B

**Trigger**: Owner creates a restaurant group and sets `loyalty_model = 'cross_recognition'`.

**Steps:**
1. Owner selects restaurants to include in the group.
2. System creates `restaurant_groups` and `restaurant_group_members` records.
3. System scans all `members` tables across the group restaurants for phone number matches.
4. For each match, creates a `group_customers` record with `consent_status = 'pending'`.
5. System queues consent request messages to all matched members (via their home brand WhatsApp number).
6. Migration report is shown to owner: X unique customers, Y cross-brand matches found, Z consent requests sent.

**Rollback**: Owner can dissolve the group. `restaurant_group_members` and `group_customers` records are soft-deleted. Member records at individual restaurants are unaffected.

**Duration estimate**: Instant for group creation. Phone matching is async (BullMQ job). For a group with 5,000 total members, matching completes in < 30 seconds. Consent messages are rate-limited per WhatsApp policy (~80/sec per WABA).

### 12.2 Model B to Model C

**Trigger**: Owner sets `loyalty_model = 'unified'` on an existing group.

**Prerequisites:**
- All members in the group must have `consent_status = 'granted'`. Members with `pending`/`denied`/`revoked` consent are excluded from the unified program (they keep per-brand memberships until they consent).
- Owner must confirm they understand this is a significant structural change.

**Steps:**
1. System creates a unified member record for each `group_customers` entry with `consent_status = 'granted'`.
2. Points balances are summed across all brand-specific member records.
3. Brand-specific member records are archived (soft-deleted with `archived_at` timestamp and `unified_member_id` pointer).
4. All `rewards` for individual restaurants in the group get `group_id` set.
5. Event history is preserved with original `restaurant_id` for location attribution.
6. New members going forward are created with `group_id` instead of `restaurant_id`.

**Rollback**: Model C to B rollback is destructive and requires manual intervention. The unified balance cannot be automatically split back. This is a one-way operation with a 7-day confirmation period.

**Data integrity checks:**
- Pre-migration: total points across all brand members == post-migration unified member points. Mismatch triggers migration halt.
- Post-migration: automated reconciliation report comparing pre/post member counts and total points.

### 12.3 Migration State Machine

```
separate (A) -> cross_recognition (B) -> unified (C)
     ^                |
     |                v
     +-- dissolve (back to A, reversible)
```

Model transitions are recorded in a `group_migrations` audit table:

```sql
CREATE TABLE group_migrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES restaurant_groups(id),
  from_model TEXT NOT NULL,
  to_model TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed', 'rolled_back')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  migration_report JSONB DEFAULT '{}'
);
```

---

## 13. Success Metrics

### Model A Enhancements

| Metric | Baseline | Target (3 months) | How Measured |
|--------|----------|--------------------|-------------|
| Multi-brand owners using portfolio view | 0% | 60% of owners with 2+ restaurants | Dashboard analytics |
| Time to compare brand performance | Manual Excel (~30 min) | < 2 min in dashboard | User interviews |

### Model B

| Metric | Baseline | Target (6 months) | How Measured |
|--------|----------|--------------------|-------------|
| Groups created | 0 | 30 groups | `restaurant_groups` count |
| Cross-brand consent rate | N/A | >50% of matched members grant consent | `group_customers` consent_status distribution |
| Cross-brand visit rate | 0% | 10% of consented members visit a sibling brand within 90 days | Cross-brand events |
| Points transfer volume | 0 | 500 transfers/month across all groups | `points_transfers` count |
| Group campaign CTR | N/A | 15% higher than single-brand campaigns | Campaign analytics |
| Revenue per group owner | Current single-brand ARPU | +40% | Billing data |
| Customer satisfaction (NPS) | Current NPS | No degradation (privacy concerns monitored) | Survey |

### Model C

| Metric | Baseline | Target (6 months post-launch) | How Measured |
|--------|----------|-------------------------------|-------------|
| Groups upgrading B to C | 0 | 20% of Model B groups | `restaurant_groups.loyalty_model` |
| Unified member satisfaction | N/A | NPS > 60 | Post-migration survey |
| Successful migrations | 0 | 100% without data loss | `group_migrations` status |

---

## 14. Risks and Mitigations

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|-----------|
| R1 | Low consent rate kills Model B value proposition | Medium | High | Design consent request as value proposition ("earn points anywhere"), not legal notice. A/B test messaging. Fallback: make Model B useful even without consent (group dashboard still works). |
| R2 | Points transfer race conditions cause balance inconsistency | Low | Critical | Postgres row-level locking in `transfer_points_across_brands`. Deadlock prevention via consistent lock ordering (by UUID). Reconciliation job runs nightly. |
| R3 | PDPO complaint from member about cross-brand data sharing | Low | High | Conservative default (no sharing without explicit consent). Consent audit trail. Legal review of consent messaging before launch. |
| R4 | Model C migration data loss | Low | Critical | Pre-migration snapshot. Points reconciliation check (sum must match). 7-day confirmation period. Automated rollback on mismatch. |
| R5 | WhatsApp template rejection for cross-brand messages | Medium | Medium | Submit templates early (2 weeks before feature launch). Have fallback plain-text versions. Work with Kapso on pre-approval. |
| R6 | Performance degradation from cross-brand queries | Medium | Medium | Indexed `group_customers.phone`. Denormalized `total_points` on `group_customers` (updated via trigger). Cache group membership in Redis. |
| R7 | Complexity overwhelms solo brand owners | Low | Medium | Group features are hidden unless user manages 2+ restaurants. No UI clutter for single-brand owners. |
| R8 | Restaurant leaves group while having outstanding cross-brand points transfers | Medium | Medium | Transfer history is preserved. Points already transferred are not clawed back. Departing restaurant's members retain their individual balances. |
| R9 | Concurrent Model upgrade (A to B) while members are actively registering | Low | Medium | Migration uses advisory lock on group_id. New registrations during migration are queued and processed after migration completes. |

---

## 15. Phased Delivery Plan

### Phase 1: Foundation and Model B Core (6 weeks)

**Goal**: Ship the minimum viable cross-brand experience.

| Week | Deliverable |
|------|------------|
| 1-2 | Database migrations: `restaurant_groups`, `restaurant_group_members`, `group_customers`, `points_transfers`. Domain entities and repository layer. RLS policies. |
| 2-3 | Group management API (create, update, add/remove restaurants). Group management UI in dashboard. |
| 3-4 | Cross-brand customer recognition (phone matching at registration). `group_customers` linking. Consent request via WhatsApp. Consent management API. |
| 4-5 | Points portability configuration. Points transfer API and Postgres function. Redemption flow updated to support cross-brand point selection. |
| 5-6 | Group dashboard (basic): member count, overlap %, points outstanding per brand. Integration testing. Bug fixes. |

**Phase 1 Exit Criteria:**
- Owner can create a group, add restaurants, and configure points portability.
- Cross-brand customer recognition works on new registrations.
- Consent flow works end-to-end via WhatsApp.
- Points can be transferred between brands during redemption.
- Group dashboard shows basic cross-brand metrics.

### Phase 2: Model B Complete (4 weeks)

**Goal**: Full Model B experience with campaigns, analytics, and POS awareness.

| Week | Deliverable |
|------|------------|
| 7-8 | Group campaigns: creation, audience targeting, execution via home-brand WhatsApp numbers. Cross-brand WhatsApp templates submitted and approved. |
| 8-9 | Group analytics dashboard: overlap matrix, customer flow, per-brand breakdowns, export. A-to-B migration tooling (bulk phone matching for existing members). |
| 9-10 | Model A portfolio view (group dashboard rollup for non-grouped restaurants). POS cross-brand awareness (recognition events on POS customer match). Event system fan-out for cross-brand events. |

**Phase 2 Exit Criteria:**
- Group campaigns can target cross-brand audiences and send via home-brand numbers.
- Analytics dashboard shows overlap matrix and customer flow.
- Existing restaurants can be migrated to Model B (phone matching on existing members).
- Solo owners see a portfolio view for their restaurants.

### Phase 3: Model C (6 weeks)

**Goal**: Unified loyalty program for groups that want maximum simplicity.

| Week | Deliverable |
|------|------------|
| 11-12 | Unified member identity: schema changes, `UNIQUE(group_id, phone)` constraint, new member creation flow for Model C groups. |
| 12-13 | B-to-C migration tooling: member merging, balance consolidation, reconciliation checks, rollback capability. |
| 13-14 | Unified reward catalog with location restrictions. Location-aware events. |
| 14-15 | Single WhatsApp channel support (one WABA for all locations). Location-aware message composition. |
| 15-16 | End-to-end testing of full A to B to C journey. Performance testing. Documentation. |

**Phase 3 Exit Criteria:**
- A Model B group can upgrade to Model C with automated migration.
- Unified member record works with points, rewards, campaigns, and POS.
- Migration reconciliation passes with zero data loss on test data sets.

---

## 16. Non-Goals and Out of Scope

### Explicitly NOT building in any phase:

| Item | Reason |
|------|--------|
| **Points exchange rates between brands** | Adds complexity with low initial demand. 1:1 parity is sufficient for launch. Can be added later if group owners request it. |
| **Group hierarchy (groups of groups)** | No market signal for this in HK mid-market segment. Enterprise groups (Maxim's) are not our target. |
| **Cross-group loyalty** (coalition model) | We are building proprietary multi-brand, not a coalition. This would be a separate product. |
| **Automated cross-brand recommendations** | "Because you eat at Sushi Ko, try Pasta House" — requires ML and behavioral analysis. Future feature. |
| **White-label group app** | A branded mobile app for the restaurant group. Out of scope; WhatsApp remains the channel. |
| **Multi-currency points** | HK-only. All points are dimensionless integers. No HKD/RMB conversion needed. |
| **Franchise model** | Franchisee vs. franchisor ownership splits, revenue sharing. Different product problem. |
| **Group billing / invoicing** | Group-level billing is a business operations concern. Will be addressed separately by the billing team. |
| **Customer-initiated brand discovery** | Customer browsing other brands in the group via WhatsApp. Interesting but not MVP. |
| **Retrospective consent** (auto-granting consent for pre-existing members) | PDPO requires explicit consent. Cannot be automated. |

### Deferred to future iterations:

| Item | When |
|------|------|
| Points exchange rates | After 20+ groups adopt Model B with portable points |
| Cross-brand reward recommendations | After Model C is stable and usage data accumulates |
| Group-level referrer program | After Phase 2, if referrer program shows traction |
| Bulk group onboarding API | When we sign a group with 10+ brands |

---

## Open Questions

| # | Question | Owner | Needed By |
|---|----------|-------|-----------|
| Q1 | Should "Pooled" portability in Model B show a single combined balance in the UI, or show per-brand balances with a "total" line? | PM + UX | Phase 1 Week 3 |
| Q2 | What is the pricing model for group plans? Per-restaurant, per-group, or tiered by group size? | PM + Biz | Phase 1 Week 1 |
| Q3 | Should consent requests be re-sent periodically to members who never responded (pending status)? If so, how often? | PM + Legal | Phase 1 Week 4 |
| Q4 | For Model C single WABA: does the group need a separate Meta Business Account, or can locations share one? Need Kapso confirmation. | Engineering | Phase 3 Week 1 |
| Q5 | Should we support removing a restaurant from a group if it has pending points transfers? What happens to in-flight transfers? | PM + Engineering | Phase 2 Week 2 |
| Q6 | Do we need a group-level "admin" role distinct from restaurant-level admin? Or is any restaurant admin in the group automatically a group admin? | PM | Phase 1 Week 1 |

---

## Appendix A: Glossary

| Term | Definition |
|------|-----------|
| **Home Brand** | The restaurant where a member originally registered. Used to determine which WhatsApp number sends messages to that member. |
| **Group Customer** | A phone-number-level identity that links member records across brands within a group. |
| **Points Portability** | The policy governing whether points earned at one brand can be spent at another. Three modes: isolated, portable, pooled. |
| **Cross-Brand Recognition** | The system's ability to identify that a customer at Brand X is the same person as a member at Brand Y, based on phone number matching. |
| **Consent Status** | The member's explicit approval (or refusal) for their data to be shared across brands within a group. Required by PDPO. |
| **Fan-Out Event** | An event emitted to sibling restaurants in a group when a cross-brand action occurs. Carries a source tag to prevent echo loops. |

## Appendix B: Related System Context

| System Component | Current State | File / Migration |
|-----------------|--------------|-----------------|
| Member entity | `UNIQUE(restaurant_id, phone)` | `src/domain/entities/member.ts`, `001_create_tables.sql` |
| Restaurant entity | Per-tenant root, includes `kapsoPhoneNumberId` | `src/domain/entities/restaurant.ts` |
| Event system | BullMQ fan-out, source-based echo prevention | `src/application/emit-event.ts`, `021_event_dispatch.sql` |
| Points adjustment | Row-level locking via `adjust_member_points` | `022_adjust_member_points.sql` |
| POS integration | Per-restaurant, HMAC webhook auth | `src/domain/entities/pos-integration.ts`, `020_pos_integration.sql` |
| Multi-tenant access | `user_tenants` M:N with RLS | `011_multi_tenant_platform_admin.sql` |
| Tenant plans | starter / growth / pro | `017_tenant_plan.sql` |
| Rewards catalog | Per-restaurant, `pointsCost`-based | `src/domain/entities/reward.ts`, `010_rewards_catalog.sql` |
| Campaigns | Per-restaurant, WhatsApp template-based | `src/domain/entities/campaign.ts` |
