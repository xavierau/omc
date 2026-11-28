# BSUID Identity Migration (WhatsApp Business-Scoped User IDs)

**Date**: 2026-04-21
**Status**: Draft
**Scope**: Medium (domain model change, schema migration, cross-cutting lookup refactor)
**Related**: Kapso WhatsApp BSUID docs — https://docs.kapso.ai/docs/whatsapp/business-scoped-user-ids

---

## 1. Context & Problem

Meta is rolling out **Business-Scoped User IDs (BSUIDs)** for WhatsApp. Once Meta starts sending BSUID-only payloads for a given tenant, the Kapso webhook contract changes in two material ways:

1. **Phone can be null** on inbound payloads. The fields `message.from`, `conversation.phone_number`, and `wa_id` may all be absent or `null`.
2. **The stable identity key becomes `business_scoped_user_id`** (format: `"US.13491208655302741918"`), carried on the `conversation` object alongside `parent_business_scoped_user_id` and a human-readable `username` (display-only; NOT stable, NOT unique, MUST NOT be used for matching).

Example payloads:

```json
// Both present (transition period)
{ "conversation": { "phone_number": "16315551181", "business_scoped_user_id": "US.1349...", "username": "@foo" }}

// BSUID-only (target state)
{ "conversation": { "phone_number": null, "business_scoped_user_id": "US.1349...", "username": "@foo" }}
```

**Outbound sending** by BSUID is expected from Meta around **May 2026** — not live yet. Until Kapso ships a BSUID-targeted send endpoint, outbound continues to use phone numbers. The BSUID outbound story is deferred (§5 "Phase 4").

Identity-change events (`user_id_update`, `user_changed_user_id`) are also deferred (§5 "Phase 3").

### Why this breaks us today

Our entire inbound pipeline is phone-keyed. If Meta sends a BSUID-only payload to any of our tenants, the webhook parser coerces `null` to `""`, every member lookup misses, and messages are silently treated as "non-member" traffic. Registration (`JOIN`) will even fail at the DB layer because `PhoneNumber.create('')` throws and `members.phone` is `NOT NULL`.

---

## 2. Current-State Audit

### 2.1 Database constraints blocking null phones

`supabase/migrations/001_create_tables.sql`

```sql
-- Line 17
phone TEXT NOT NULL,

-- Line 24
CREATE UNIQUE INDEX idx_members_restaurant_phone ON members(restaurant_id, phone);
```

Both must relax to allow BSUID-only members.

### 2.2 Parser drops BSUID fields and coerces null

`src/infrastructure/kapso/webhook-parser.ts`

- Line 90: `from: (msg.from as string) ?? ''` — coerces null to empty string.
- `KapsoMessage` interface (lines 7–16) has no BSUID fields.
- `parseKapsoFormat` (lines 68–79) reads `conversation.contact_name` but ignores `business_scoped_user_id`, `parent_business_scoped_user_id`, `username`.
- `parseMetaWebhook` (lines 49–66) ignores the same conversation fields.

### 2.3 Phone-keyed member lookups (every inbound path)

Six call sites silently return "not a member" if phone is null/empty:

| # | File | Line | Context |
|---|------|------|---------|
| 1 | `src/app/api/webhooks/whatsapp/handlers.ts` | 18 | `PhoneNumber.create(message.from)` throws on `""` |
| 2 | `src/app/api/webhooks/whatsapp/handlers.ts` | 56 | `handlePoints` — `.eq('phone', phone)` |
| 3 | `src/app/api/webhooks/whatsapp/handlers.ts` | 129–133 | `findMemberByPhone` helper |
| 4 | `src/app/api/webhooks/whatsapp/member-handlers.ts` | 13, 30, 56, 102, 131 | `handleRedeem`, `handleUnsubscribe`, `handleRewards`, `handleRewardRedeem`, local helper |
| 5 | `src/application/register-member.ts` | 45 | `findExistingMember` — `.eq('phone', phone)` |
| 6 | `src/application/link-pos-customer.ts` | 19 → `src/infrastructure/supabase/repositories/pos-transaction-repository.ts` | 80 | `findUnlinkedTransactionsByPhone` |

### 2.4 Port types missing fields

`src/domain/ports/whatsapp-webhooks.ts`

```typescript
export interface InboundMessage {
  from: string        // non-null; must become: from?: string
  // no BSUID, parentBsuid, username fields
}
```

### 2.5 Safe (for now)

- `src/infrastructure/kapso/client.ts` — outbound sends by phone; Meta + Kapso both still accept phone targeting until ~May 2026.
- `src/application/execute-campaign.ts:87` — campaign sender reads `member.phone`; falls inside Phase 4 scope.

---

## 3. Target State

### 3.1 Identity model

A member's WhatsApp identity is a composite: **BSUID (preferred) + phone (fallback)**. Either, both, or (transiently) neither may be present on a given inbound message; over time BSUID becomes the canonical key.

```
          ┌──────────────────────────────────────┐
          │             WhatsAppIdentity         │
          ├──────────────────────────────────────┤
          │ bsuid?: string    ← primary lookup   │
          │ phone?: PhoneNumber ← fallback + O/B │
          │ username?: string ← display only     │
          │ parentBsuid?: string ← future use    │
          └──────────────────────────────────────┘
```

**Invariant**: at least one of `bsuid` or `phone` must be present on any inbound message we act on. If both are null, we log-and-drop the message (see §11).

### 3.2 Lookup strategy (BSUID-first, phone-fallback, lazy backfill)

```
        inbound message
              │
              ▼
  ┌───────────────────────┐
  │ has bsuid?            │─yes──► findByBsuid(restaurantId, bsuid)
  └───────────────────────┘                    │
              │                                ▼
              no                    match? ──► use it
              │                                │
              ▼                                no
  has phone? ──► findByPhone(restaurantId, phone) ◄─┐
              │          │                          │
              no         ▼                   backfill bsuid
              │     match? ──► use it ─────► onto matched member
              ▼          │                          │
         log & drop      no                         ▼
                         ▼                   future lookups hit
                    new member / register      BSUID index
```

Backfill is **lazy, upsert-style** on every inbound match — never a batch job (§4 decision 1).

### 3.3 Outbound remains phone-keyed

Outbound sending (Kapso `/v1/messages` with `to: phoneNumber`) is unchanged in this sprint. When Meta/Kapso ship BSUID outbound (~May 2026), we add a new adapter path (Phase 4, deferred). For now, a BSUID-only member has `phone = null` and is **not reachable** by outbound — this is an acceptable limitation during the transition (documented risk in §11).

---

## 4. Design Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | **Lazy backfill** of BSUID onto existing phone-keyed members; no one-shot backfill migration. | Existing members only need a BSUID when they next message us. A one-shot script would require a privileged Meta/Kapso lookup API we don't have and would churn every row for no user-visible benefit. Lazy path is self-healing and minimal. |
| 2 | **`username` is stored but never queried for matching.** | Meta documents `username` as display-only and explicitly not a stable identity. Using it for joins would create ghost accounts and merge collisions on rename. |
| 3 | **Direct-to-prod rollout, no feature flag.** | All changes are additive and backwards compatible: nullable column + new nullable columns + partial unique indexes + BSUID-first-then-phone lookup still resolves every existing phone-keyed member. There is no code path a flag would usefully gate. |
| 4 | **Phase 3 (identity-change events) is deferred.** | `user_id_update` / `user_changed_user_id` handling needs wire-level examples we haven't seen. Premature design would mis-model the event shape. Log and alert when the first one arrives, then design against reality. |
| 5 | **Phase 4 (BSUID outbound sending) is deferred** until Kapso ships the endpoint (~May 2026). | The send API does not exist yet. Designing against speculation guarantees rework. |

---

## 5. Phased Plan

### Phase 1 — Schema + Parser (in scope)

Relax DB constraints, extend parser to surface BSUID fields, update port types. After Phase 1, no runtime call site changes behavior — BSUID fields are captured but unused.

### Phase 2 — Identity-first Lookup (in scope)

Introduce `findMemberByIdentity` domain service + repository support. Refactor all six phone-keyed call sites to identity-keyed. Registration upserts BSUID onto the existing row on first match (lazy backfill).

### Phase 3 — Identity Reconciliation (deferred)

Handle Meta `user_id_update` / `user_changed_user_id` events: merge two member rows when Meta tells us they are the same user. Not designed in this doc.

### Phase 4 — BSUID Outbound (deferred)

When Kapso ships BSUID-targeted sends, introduce a new outbound adapter path. Members with `phone = null` become reachable. Not designed in this doc.

---

## 6. Schema Migration

### 6.1 File naming note

The next unused migration number is `025_` (through `024_require_webhook_secret.sql`). The original request referenced `021_bsuid_identity.sql` but `021` is already used. This doc proposes **`025_bsuid_identity.sql`** — see §11 open question Q1.

### 6.2 Forward migration

```sql
-- ============================================================
-- 025_bsuid_identity.sql
-- Relax phone NOT NULL; add BSUID identity columns & indexes
-- ============================================================

-- 1. Relax phone NOT NULL (BSUID-only members are now legal)
ALTER TABLE members
  ALTER COLUMN phone DROP NOT NULL;

-- 2. Add BSUID identity columns
ALTER TABLE members
  ADD COLUMN business_scoped_user_id        TEXT,
  ADD COLUMN parent_business_scoped_user_id TEXT,
  ADD COLUMN username                        TEXT;

COMMENT ON COLUMN members.business_scoped_user_id IS
  'WhatsApp Business-Scoped User ID (BSUID). Primary identity key. Format e.g. "US.13491208655302741918".';
COMMENT ON COLUMN members.parent_business_scoped_user_id IS
  'Parent BSUID for linked business portfolios. Reserved for future use.';
COMMENT ON COLUMN members.username IS
  'Display-only handle from Meta (e.g. "@foo"). NEVER used for identity matching.';

-- 3. Replace the old unique index with two partial unique indexes
--    (allows a member to have ONLY bsuid, ONLY phone, or both)
DROP INDEX IF EXISTS idx_members_restaurant_phone;

CREATE UNIQUE INDEX idx_members_restaurant_phone
  ON members(restaurant_id, phone)
  WHERE phone IS NOT NULL;

CREATE UNIQUE INDEX idx_members_restaurant_bsuid
  ON members(restaurant_id, business_scoped_user_id)
  WHERE business_scoped_user_id IS NOT NULL;

-- 4. Non-unique lookup index for bsuid (fast lookup in findByBsuid path)
--    Note: the partial unique index above already covers this; we do not
--    add a second index. Listed here only to state intent.
```

### 6.3 Rollback reference

```sql
-- ============================================================
-- 025_bsuid_identity.rollback.sql  (for reference only — not auto-run)
-- ============================================================

-- WARNING: this rollback will FAIL if any member row has phone IS NULL.
-- If BSUID-only members exist at rollback time, first decide whether to
-- delete them or attempt to re-derive phone (no automated path exists).

DROP INDEX IF EXISTS idx_members_restaurant_bsuid;
DROP INDEX IF EXISTS idx_members_restaurant_phone;

ALTER TABLE members
  DROP COLUMN IF EXISTS username,
  DROP COLUMN IF EXISTS parent_business_scoped_user_id,
  DROP COLUMN IF EXISTS business_scoped_user_id;

ALTER TABLE members
  ALTER COLUMN phone SET NOT NULL;

CREATE UNIQUE INDEX idx_members_restaurant_phone
  ON members(restaurant_id, phone);
```

### 6.4 Key schema decisions

| Decision | Rationale |
|----------|-----------|
| `ALTER COLUMN phone DROP NOT NULL` | BSUID-only members legal from Phase 1 onward. |
| Partial unique indexes (`WHERE ... IS NOT NULL`) | Preserves uniqueness per-tenant for each identity key while permitting null on either. PostgreSQL treats `NULL` as distinct in a standard unique index, but a partial index is more explicit and more efficient. |
| Three columns (BSUID, parent BSUID, username) added together | Payload delivers them together; one migration; one code path. |
| No `member_identity_history` table | Phase 3 concern. YAGNI. |
| No CHECK constraint enforcing `bsuid OR phone NOT NULL` | The DB can't enforce which identity key arrived for a given message; we enforce at parse time. Adding a CHECK would block legitimate edge cases (e.g. admin-created members) with no clear win. |

---

## 7. Domain Model Changes

### 7.1 Updated `InboundMessage` port

`src/domain/ports/whatsapp-webhooks.ts`

```typescript
export interface InboundMessage {
  messageId: string
  // Identity fields — at least one of `from` or `businessScopedUserId`
  // MUST be non-null for us to process the message.
  from?: string
  businessScopedUserId?: string
  parentBusinessScopedUserId?: string
  username?: string
  // Message body
  type: 'text' | 'image' | 'interactive' | 'unknown'
  text?: string
  imageUrl?: string
  imageId?: string
  timestamp: string
  contactName?: string
}
```

### 7.2 Updated `KapsoMessage` in parser

`src/infrastructure/kapso/webhook-parser.ts`

```typescript
export interface KapsoMessage {
  messageId: string
  from?: string                         // was: from: string
  businessScopedUserId?: string         // NEW
  parentBusinessScopedUserId?: string   // NEW
  username?: string                     // NEW
  type: 'text' | 'image' | 'interactive' | 'unknown'
  text?: string
  imageUrl?: string
  imageId?: string
  timestamp: string
  contactName?: string
}
```

**Parser behavior change**: `buildMessage` no longer coerces `msg.from` to `""`. Both parser branches (Meta, Kapso) must read `payload.conversation` (or Meta's `contacts[0]` equivalent when applicable) and surface the three new fields.

### 7.3 New value object

`src/domain/value-objects/whatsapp-identity.ts`

```typescript
import { PhoneNumber } from './phone-number'

export class WhatsAppIdentity {
  private constructor(
    readonly bsuid: string | undefined,
    readonly phone: PhoneNumber | undefined,
    readonly username: string | undefined,
    readonly parentBsuid: string | undefined
  ) {}

  static fromInbound(input: {
    bsuid?: string
    rawPhone?: string
    username?: string
    parentBsuid?: string
  }): WhatsAppIdentity {
    const phone = input.rawPhone ? PhoneNumber.create(input.rawPhone) : undefined
    const bsuid = input.bsuid ? normalizeBsuid(input.bsuid) : undefined

    if (!bsuid && !phone) {
      throw new Error('WhatsAppIdentity requires at least one of bsuid or phone')
    }
    return new WhatsAppIdentity(bsuid, phone, input.username, input.parentBsuid)
  }

  get primaryKey(): { bsuid?: string; phone?: string } {
    return { bsuid: this.bsuid, phone: this.phone?.value }
  }
}

// Trim whitespace, preserve exact case and the "US." / region prefix.
// Do NOT lowercase — BSUIDs are opaque tokens; any normalization beyond
// trim risks a false mismatch on a later payload.
function normalizeBsuid(raw: string): string {
  return raw.trim()
}
```

**Size**: ≤30 lines — within the file-size budget. Constructor private, factory enforces invariant (SOLID: S + D).

---

## 8. Identity Lookup Contract

### 8.1 Domain service signature

`src/domain/services/member-identity-lookup.ts` (interface) — implementation in `src/infrastructure/supabase/repositories/member-repository.ts`.

```typescript
export interface MemberIdentityQuery {
  restaurantId: string
  bsuid?: string
  phone?: string
}

export interface MemberIdentityMatch {
  id: string
  phone: string | null
  bsuid: string | null
  pointsBalance: number
  name: string | null
  /** True iff the match was via phone but the query also supplied a bsuid
   *  that is not yet persisted — caller SHOULD backfill. */
  needsBsuidBackfill: boolean
}

export async function findMemberByIdentity(
  query: MemberIdentityQuery
): Promise<MemberIdentityMatch | null>
```

### 8.2 Semantics

1. If `query.bsuid` provided:
   - `SELECT ... WHERE restaurant_id = ? AND business_scoped_user_id = ?`
   - If match → return with `needsBsuidBackfill = false`.
2. Else if `query.phone` provided:
   - `SELECT ... WHERE restaurant_id = ? AND phone = ?`
   - If match → return with `needsBsuidBackfill = (query.bsuid != null && row.business_scoped_user_id == null)`.
3. If neither provided → throw (caller violated contract — parser guarantees at least one is present).
4. No match → return `null`.

### 8.3 Backfill contract

The caller (registration, routing helpers) decides when to write BSUID back:

```typescript
const match = await findMemberByIdentity({ restaurantId, bsuid, phone })
if (match?.needsBsuidBackfill) {
  await backfillMemberBsuid(match.id, {
    bsuid: bsuid!,
    parentBsuid,
    username,
  })
}
```

`backfillMemberBsuid(memberId, fields)` is an idempotent update: `UPDATE members SET business_scoped_user_id = $1, parent_business_scoped_user_id = $2, username = $3 WHERE id = $4 AND business_scoped_user_id IS NULL`. The `IS NULL` guard makes concurrent backfills safe.

### 8.4 Call-site refactor

Every phone-keyed lookup in §2.3 becomes an identity-keyed lookup. All six use the same helper; the six ad-hoc `findMemberByPhone` inline helpers collapse into one shared service.

---

## 9. Registration Flow

`src/application/register-member.ts`

### 9.1 New signature

```typescript
interface RegisterMemberInput {
  restaurantId: string
  identity: WhatsAppIdentity       // was: rawPhone: string
  contactName?: string
}

export async function registerMember(
  input: RegisterMemberInput
): Promise<RegisterResult>
```

### 9.2 Behavior

```
1. existing = findMemberByIdentity({ restaurantId, bsuid, phone })
2. if existing:
     a. if needsBsuidBackfill → backfill bsuid, parentBsuid, username
     b. sendWelcomeBack
     c. return { isNew: false, memberId: existing.id, ... }
3. else:
     a. INSERT members { restaurant_id, phone, bsuid, parent_bsuid, username, name }
        (any of phone/bsuid may be null, both must not be)
     b. createWelcomeCoupon + emit 'join' event
     c. send welcome + QR
     d. return { isNew: true, ... }
```

### 9.3 Outbound message guard

Both `sendWelcomeBack` and the new-member welcome path require `phone`. If a BSUID-only member registers in Phase 1/2, we can't send them a message. Behavior: record the member, emit `join` event, **skip outbound sends**, log `member.registered_unreachable` warning. The member becomes reachable in Phase 4 (BSUID outbound) without data loss.

---

## 10. Testing Strategy

### 10.1 Fixtures (drop into `src/infrastructure/kapso/__tests__/fixtures/`)

| Fixture | `from` | `bsuid` | `username` | Purpose |
|---------|--------|---------|------------|---------|
| `phone-and-bsuid.json` | `"16315551181"` | `"US.1349..."` | `"@alice"` | Transition period: both present |
| `bsuid-only.json` | `null` | `"US.1349..."` | `"@alice"` | Target state: no phone |
| `phone-only.json` | `"16315551181"` | absent | absent | Legacy tenant: pre-BSUID rollout |
| `no-identity.json` | `null` | absent | absent | Malformed — parser drops |

### 10.2 Unit tests

- `webhook-parser.test.ts` — one test per fixture; assert shape of `InboundMessage`.
- `whatsapp-identity.test.ts` — invariant: at least one of bsuid/phone; BSUID normalization is trim-only.
- `member-identity-lookup.test.ts` — 3 scenarios below as repository integration tests.

### 10.3 Integration scenarios (the three cases the user called out)

| # | Setup | Inbound | Expectation |
|---|-------|---------|-------------|
| A | DB: `member { phone: "+16315551181", bsuid: null }` | phone + BSUID both present | Match on phone; `needsBsuidBackfill = true`; after use-case run, row has `bsuid = "US.1349..."`. |
| B | DB: empty | BSUID-only | No match; registration inserts `{ phone: null, bsuid: "US.1349..." }`. No outbound send. |
| C | DB: `member { phone: "+16315551181", bsuid: "US.1349..." }` | phone + BSUID both present | Match on BSUID (primary path); `needsBsuidBackfill = false`; no writes. |

Plus:

| # | Setup | Inbound | Expectation |
|---|-------|---------|-------------|
| D | DB: `member { phone: null, bsuid: "US.1349..." }` (from scenario B) | phone + BSUID both present | Match on BSUID; `needsBsuidBackfill = false`. Phone is NOT back-written (we never overwrite an existing field; phone backfill is a Phase 3 question). |
| E | Two DB rows: `{ phone: P, bsuid: null }` and `{ phone: null, bsuid: B }` | payload has both P and B | Match on BSUID (primary). The phone-P member is ignored. See §11 Q3 for the collision question. |

### 10.4 TDD order per task

Per repo convention (`CLAUDE.md` + `clean-architecture-skill`): test file before implementation file. Each backend task in §13 lists its test file first.

---

## 11. Risks & Open Questions

### Risks

| Risk | Mitigation |
|------|------------|
| BSUID-only member is unreachable until Phase 4. | Log `member.registered_unreachable`; expose in observability dashboard; document for ops. |
| Parser regression drops phone-only tenants. | Fixture `phone-only.json` + existing regression tests. |
| Two rows exist for the same human: one phone-keyed (legacy), one BSUID-keyed (new) — we never merge. | Phase 3 / `user_id_update` handling. For Phase 1-2 we **do not** attempt automatic merge; we log the collision when detected (see Q3). |
| Outbound campaign hits BSUID-only members with `member.phone = null` and crashes. | §12 exit criterion: `execute-campaign.ts` filters `phone IS NOT NULL` until Phase 4. |
| We silently overwrite a BSUID on re-backfill if Meta issues a new one. | Backfill update is guarded by `WHERE business_scoped_user_id IS NULL` — never overwrites. |

### Open questions

| # | Question | Proposal |
|---|----------|----------|
| Q1 | Migration filename: user asked for `021_bsuid_identity.sql`, but `021` is already taken by `021_event_dispatch.sql`. Actual next unused number is `025`. | Use `025_bsuid_identity.sql`. Confirm before implementation. |
| Q2 | Is `username` ever nullable in the payload? Kapso docs show it present but do not guarantee presence. | Treat as optional (`username?: string`). Parser reads defensively. |
| Q3 | If two existing members collide — one matched by phone, one matched by BSUID — what do we do? | Phase 1-2: BSUID wins (primary path). Log `identity.collision_detected` with both member IDs so ops can merge manually. Automatic merge = Phase 3. |
| Q4 | Do we normalize BSUID format beyond trim? (e.g. uppercase the region prefix?) | **No.** Kapso treats BSUIDs as opaque tokens; any normalization beyond trim risks a false mismatch on a later payload. |
| Q5 | Meta format webhook (`object === 'whatsapp_business_account'`) — does it carry `conversation.business_scoped_user_id`, or is BSUID only on Kapso-native payloads? | Flagged for implementer: inspect live Meta payloads during Phase 1 task BSUID-003. If Meta doesn't carry BSUID on this route, document and skip. |
| Q6 | Should we index `username` for debugging/search? | No. YAGNI. Column exists; sequential scan is fine at our row count. |

---

## 12. Exit Criteria

Phase 1 + 2 are complete when:

1. **Schema**: migration `025_bsuid_identity.sql` applied in prod. `\d members` shows `phone` nullable, three new columns, two partial unique indexes.
2. **Parser**: `webhook-parser.test.ts` green on all 4 fixtures. `InboundMessage.from` is optional; `businessScopedUserId` is populated whenever the payload contains it.
3. **Lookup**: `findMemberByIdentity` has test coverage for scenarios A-E (§10.3). All 6 call sites from §2.3 use the new helper; `grep -n "\.eq('phone', phone)"` on `src/app/api/webhooks/**` and `src/application/register-member.ts` returns zero hits.
4. **Backfill**: Scenario A integration test asserts DB row gains `business_scoped_user_id` after first inbound match.
5. **Registration**: `registerMember` accepts a BSUID-only identity. Scenario B integration test green (member inserted, no outbound attempted, warning logged).
6. **Campaign safety**: `execute-campaign.ts` filters `phone IS NOT NULL` (or equivalent guard).
7. **Observability**: structured logs emit `identity.bsuid_only_inbound`, `identity.bsuid_backfilled`, `identity.collision_detected`, `member.registered_unreachable`. Dashboard (or a saved log query) exists.
8. **No regressions**: existing phone-only integration tests (tenant without BSUID rollout) still green.

---

## 13. Task Breakdown

### Phase 1 + 2 (single sprint)

| # | Task | Dependencies | TDD |
|---|------|--------------|-----|
| BSUID-001 | Write migration `025_bsuid_identity.sql` + rollback reference. | None | Manual: apply locally, `\d members`, rollback, re-apply. |
| BSUID-002 | Update `InboundMessage` port + `KapsoMessage` interface to add BSUID fields and make `from` optional. | None | Typecheck; no runtime test — interface-only change. |
| BSUID-003 | Extend `webhook-parser.ts`: read `conversation.business_scoped_user_id`, `parent_business_scoped_user_id`, `username`; stop coercing `from` to `""`. Add 4 fixtures + parser test. | BSUID-002 | Test before impl: `webhook-parser.test.ts` with 4 fixtures. |
| BSUID-004 | Implement `WhatsAppIdentity` value object + `findMemberByIdentity` repository function + `backfillMemberBsuid`. | BSUID-001, BSUID-002 | Test before impl: VO invariants; repo scenarios A-E. |
| BSUID-005 | Introduce shared `findMemberByIdentity` helper + refactor all 6 phone-keyed call sites (`handlers.ts`, `member-handlers.ts`, `register-member.ts`, `pos-transaction-repository.ts::findUnlinkedTransactionsByPhone`) to use it. Remove inline `findMemberByPhone` duplicates. | BSUID-004 | Test before impl: one integration test per call site asserting BSUID-first lookup + fallback. |
| BSUID-006 | Update `registerMember` to accept `WhatsAppIdentity`, upsert BSUID on existing member (lazy backfill), guard outbound sends on `phone != null`. | BSUID-004, BSUID-005 | Test before impl: scenarios A, B, C, D from §10.3. |
| BSUID-007 | Null-phone handling in POS linking: `findUnlinkedTransactionsByPhone` early-returns `[]` when phone is null; `link-pos-customer` accepts optional phone. | BSUID-005 | Test before impl: null-phone path returns `{ linkedCount: 0, totalPoints: 0 }` without querying. |
| BSUID-008 | Guard outbound campaign sender (`execute-campaign.ts`) to skip members where `phone IS NULL`; log `campaign.skipped_unreachable_member`. | BSUID-001 | Test before impl: campaign with one BSUID-only member skips it, count is correct. |
| BSUID-009 | Observability: structured logs for `identity.bsuid_only_inbound`, `identity.bsuid_backfilled`, `identity.collision_detected`, `member.registered_unreachable`. | BSUID-005, BSUID-006 | Test before impl: log assertions on each event. |

**Deferred (not in this sprint):**
- Phase 3: identity reconciliation on `user_id_update` — re-scope when first live event observed.
- Phase 4: BSUID outbound sending — re-scope when Kapso endpoint ships.

---

## 14. File Inventory

### New

```
supabase/migrations/025_bsuid_identity.sql

src/domain/value-objects/whatsapp-identity.ts
src/domain/services/member-identity-lookup.ts
src/domain/value-objects/__tests__/whatsapp-identity.test.ts

src/infrastructure/kapso/__tests__/fixtures/phone-and-bsuid.json
src/infrastructure/kapso/__tests__/fixtures/bsuid-only.json
src/infrastructure/kapso/__tests__/fixtures/phone-only.json
src/infrastructure/kapso/__tests__/fixtures/no-identity.json
```

### Modified

```
src/domain/ports/whatsapp-webhooks.ts                                  # InboundMessage fields
src/infrastructure/kapso/webhook-parser.ts                             # KapsoMessage + parser branches
src/infrastructure/kapso/__tests__/webhook-parser.test.ts              # fixture-driven coverage
src/infrastructure/supabase/repositories/member-repository.ts          # findMemberByIdentity, backfillMemberBsuid
src/infrastructure/supabase/repositories/pos-transaction-repository.ts # null-phone guard in findUnlinkedTransactionsByPhone
src/app/api/webhooks/whatsapp/handlers.ts                              # use findMemberByIdentity
src/app/api/webhooks/whatsapp/member-handlers.ts                       # use findMemberByIdentity
src/application/register-member.ts                                     # WhatsAppIdentity signature + lazy backfill
src/application/link-pos-customer.ts                                   # optional phone
src/application/execute-campaign.ts                                    # filter phone IS NOT NULL
```
