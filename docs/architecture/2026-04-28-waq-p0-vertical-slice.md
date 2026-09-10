# WAQ P0 Vertical Slice — Per-Message Tracking, Status Webhook, Error Code Routing

Date: 2026-04-28
Status: Draft for review (no implementation started)
Scope: WAQ-001, WAQ-002, WAQ-003 only — see boundaries at the end

## 0. Context and goal

The next production tenant onboarding is a marketing-heavy customer with hundreds of contacts, currently gated on this work. We have **zero per-message persistence** today: `src/application/execute-campaign-batch.ts` increments a counter (`incrementCampaignSent`) and emits a generic `events.type='campaign'` row, but never records the recipient, the WhatsApp message id, or any delivery state. The existing wrappers in `src/infrastructure/kapso/client.ts:36-40` actively **discard** the SDK's return value, which is exactly the `wamid...` we now need.

This slice introduces:

1. A new `whatsapp_messages` table that records every outbound send and is updated by status webhooks (WAQ-001).
2. An extension of the existing webhook pipeline (`src/app/api/webhooks/whatsapp/route.ts`, `handlers.ts`) to ingest outbound `statuses` events alongside today's inbound message routing (WAQ-002).
3. An error-code dispatcher that, on `status='failed'`, mutates `members` (new `pmm_throttled_until`, `unreachable_at` columns) and signals the platform team for policy violations (WAQ-003).

It does **not** introduce consent records, cooldown enforcement, quality polling, or auto-pause — those are WAQ-004+ and are explicitly out of scope.

Once this lands, every later quality task in the epic (cooldown query, delivery-rate dashboards, auto-pause triggers) is a read or update against the same `whatsapp_messages` rows.

---

## 1. Schema design

### 1.1 New table: `whatsapp_messages`

Migration file: `supabase/migrations/035_whatsapp_messages.sql`.

```sql
-- One row per WhatsApp message we send (and, optionally later, receive).
-- Updated in-place by the outbound status webhook handler.
CREATE TABLE whatsapp_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  member_id UUID REFERENCES members(id) ON DELETE SET NULL,
  campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,

  -- Routing identity
  phone_e164 TEXT NOT NULL,                -- denormalised; member may be deleted
  direction TEXT NOT NULL CHECK (direction IN ('outbound', 'inbound')),

  -- Classification (drives cooldown / PMM logic in WAQ-007+)
  category TEXT NOT NULL
    CHECK (category IN ('marketing', 'utility', 'authentication', 'service')),

  -- Content shape
  message_type TEXT NOT NULL
    CHECK (message_type IN ('text', 'image', 'template', 'interactive')),
  template_id UUID REFERENCES whatsapp_templates(id) ON DELETE SET NULL,
  template_name TEXT,                      -- denormalised at send time
  content_preview TEXT,                    -- first ~120 chars of text/caption, never PII

  -- BSP correlation
  kapso_message_id TEXT UNIQUE,            -- the wamid... from BSP. Nullable: send may fail before BSP returns.
  raw_send_response JSONB,                 -- full SendMessageResponse on success; nullable.

  -- State machine (see §2.2 for transitions)
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'sent', 'delivered', 'read', 'failed')),
  error_code TEXT,                         -- Meta numeric code as string (e.g. '131049')
  error_title TEXT,
  error_details TEXT,
  raw_status_payload JSONB,                -- last status webhook body for forensics

  -- Timestamps (NULL until that transition occurs)
  queued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

#### 1.1.1 Why a single mutable row, not event-sourced

I considered an append-only `whatsapp_message_status_events` table (one row per status webhook). Rejecting it for this slice:

- The read patterns we need (delivery rate per campaign, last-N marketing sends per recipient, failed-error-code counts per tenant) are all **last-known-status** queries. An event-sourced model forces a `DISTINCT ON (kapso_message_id) ORDER BY received_at DESC` on every read.
- Idempotency for replays already lives in `processed_webhooks` (existing pattern at `supabase/migrations/001_create_tables.sql:88-93`). An event log would duplicate that responsibility.
- We keep the **last** raw payload in `raw_status_payload` JSONB. That is enough forensic context for 95% of incidents; if we ever need full history, adding the events table later is an additive migration that backfills nothing.

Decision: single mutable row. Revisit if/when WAQ-008 (delivery analytics with time-bucketed retention) demands history beyond "last status".

#### 1.1.2 Indexes

```sql
-- Webhook handler: O(1) lookup by BSP id (the hot path on every status event)
-- Already enforced by UNIQUE on kapso_message_id.

-- Per-campaign delivery rate (campaign analytics)
CREATE INDEX idx_wa_messages_campaign_status
  ON whatsapp_messages(campaign_id, status)
  WHERE campaign_id IS NOT NULL;

-- Per-tenant 7d read rate, error-code rate alerts
CREATE INDEX idx_wa_messages_restaurant_sent_at
  ON whatsapp_messages(restaurant_id, sent_at DESC)
  WHERE sent_at IS NOT NULL;

-- WAQ-007 cooldown: "last N marketing sends to this recipient in last 24h"
-- The (member_id, category, sent_at DESC) shape covers both the per-recipient
-- and per-recipient-per-category access patterns.
CREATE INDEX idx_wa_messages_member_category_sent
  ON whatsapp_messages(member_id, category, sent_at DESC)
  WHERE member_id IS NOT NULL AND sent_at IS NOT NULL;

-- Failed-error-code monitoring (for §6 error dispatch and WAQ-009 alerts)
CREATE INDEX idx_wa_messages_error_code
  ON whatsapp_messages(restaurant_id, error_code, failed_at DESC)
  WHERE error_code IS NOT NULL;
```

#### 1.1.3 RLS — mirror migration 011

```sql
ALTER TABLE whatsapp_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY whatsapp_messages_select ON whatsapp_messages
  FOR SELECT USING (
    restaurant_id IN (SELECT user_restaurant_ids()) OR is_platform_admin()
  );

-- INSERT and UPDATE are performed by the service-role key from API routes
-- (createServerSupabaseClient in src/infrastructure/supabase/client.ts:11-16
--  uses SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS). We still add the
-- policies so dashboards and direct admin queries respect tenancy.
CREATE POLICY whatsapp_messages_insert ON whatsapp_messages
  FOR INSERT WITH CHECK (
    restaurant_id IN (SELECT user_restaurant_ids()) OR is_platform_admin()
  );
CREATE POLICY whatsapp_messages_update ON whatsapp_messages
  FOR UPDATE USING (
    restaurant_id IN (SELECT user_restaurant_ids()) OR is_platform_admin()
  );
```

#### 1.1.4 `updated_at` trigger

Reuse the pattern from `supabase/migrations/016_campaign_guardrails.sql:33-43`:

```sql
CREATE TRIGGER set_whatsapp_messages_updated_at
  BEFORE UPDATE ON whatsapp_messages
  FOR EACH ROW EXECUTE FUNCTION update_campaign_settings_updated_at();
-- (rename the function to update_updated_at_column() in a future cleanup)
```

### 1.2 `members` column additions (WAQ-003)

Migration file: `supabase/migrations/036_member_quality_state.sql`.

```sql
ALTER TABLE members
  ADD COLUMN pmm_throttled_until TIMESTAMPTZ,
  ADD COLUMN unreachable_at TIMESTAMPTZ;

-- Cooldown queries during send (WAQ-007 will use this; we add the index now
-- so the WAQ-007 PR is purely application code).
CREATE INDEX idx_members_pmm_throttled_until
  ON members(pmm_throttled_until)
  WHERE pmm_throttled_until IS NOT NULL;

CREATE INDEX idx_members_unreachable_at
  ON members(unreachable_at)
  WHERE unreachable_at IS NOT NULL;
```

Semantics:

- `pmm_throttled_until` — set on `131049`. Send paths must skip the recipient until `now() > pmm_throttled_until`. Cleared by setting to NULL when the cooldown elapses (lazy: next send simply ignores the past timestamp; no scheduled job needed).
- `unreachable_at` — set once on `131026`. Once set, the recipient is permanently skipped for marketing. CS staff can manually clear via admin tool (out of scope for this slice; for now it's a one-way flag and ops clears it via SQL).

No change to `members.status` — that column is `'active'|'unsubscribed'` and reflects user-driven opt-out. `unreachable_at` reflects an upstream signal (number not on WhatsApp / blocked us). These are intentionally separate.

---

## 2. Domain layer

### 2.1 New files

```
src/domain/
├── entities/
│   └── whatsapp-message.ts              # WhatsAppMessage entity + transitions
├── value-objects/
│   ├── whatsapp-error-code.ts           # WhatsAppErrorCode + classify()
│   └── message-status.ts                # MessageStatus state machine helper
└── repositories/                         # NEW directory
    └── whatsapp-message-repository.ts   # interface only
```

The project does **not currently have** `src/domain/repositories/` — repository contracts live as named function imports against `src/infrastructure/supabase/repositories/*` (e.g. `findMemberByPhone` is imported directly from the infra file). That is a Dependency Inversion violation we are not chartered to refactor here. **Decision**: introduce the interface for `WhatsAppMessageRepository` because this slice is greenfield, but follow the project's *existing* convention for everything else (the repo's mapper + named-export functions are the de-facto contract).

### 2.2 `WhatsAppMessage` entity

Why an entity rather than a row DTO: the status transitions are non-trivial (`queued → sent → delivered → read`, with `failed` reachable from any prior state), and centralising them prevents the webhook handler from accidentally regressing `read` back to `delivered` because of out-of-order webhooks.

```typescript
// src/domain/entities/whatsapp-message.ts
import { MessageStatus } from '../value-objects/message-status'

export interface WhatsAppMessageProps {
  id: string
  restaurantId: string
  memberId: string | null
  campaignId: string | null
  phoneE164: string
  direction: 'outbound' | 'inbound'
  category: 'marketing' | 'utility' | 'authentication' | 'service'
  messageType: 'text' | 'image' | 'template' | 'interactive'
  templateId: string | null
  templateName: string | null
  contentPreview: string | null
  kapsoMessageId: string | null
  status: MessageStatus
  errorCode: string | null
  errorTitle: string | null
  errorDetails: string | null
  queuedAt: string
  sentAt: string | null
  deliveredAt: string | null
  readAt: string | null
  failedAt: string | null
}

export class WhatsAppMessage {
  private constructor(private readonly props: WhatsAppMessageProps) {}

  static queue(input: QueueOutboundInput): WhatsAppMessage { /* … */ }

  // Idempotent state transition. Out-of-order webhooks (read before delivered)
  // promote the row to the most-progressed state but never regress it.
  applyStatusUpdate(update: StatusUpdate): WhatsAppMessage { /* … */ }

  get snapshot(): Readonly<WhatsAppMessageProps> { return this.props }
}
```

The `applyStatusUpdate` method enforces the only invariant that matters: **status only moves forward in the lattice** `queued < sent < delivered < read`, and `failed` is terminal once a non-`131049` retryable error code is set.

### 2.3 `MessageStatus` value object

Plain TS union plus a comparator helper — keeps the entity small.

```typescript
// src/domain/value-objects/message-status.ts
export type MessageStatus = 'queued' | 'sent' | 'delivered' | 'read' | 'failed'

const ORDER: Record<Exclude<MessageStatus, 'failed'>, number> = {
  queued: 0, sent: 1, delivered: 2, read: 3,
}

export function isProgression(from: MessageStatus, to: MessageStatus): boolean {
  if (to === 'failed') return from !== 'read' // 'read' is terminal-success
  if (from === 'failed') return false         // failed never recovers
  return ORDER[to] > ORDER[from]
}
```

### 2.4 `WhatsAppErrorCode` value object

Single source of truth for the error-code → action mapping. Section 6 owns the table; the value object owns the lookup.

```typescript
// src/domain/value-objects/whatsapp-error-code.ts
export type ErrorAction =
  | 'throttle_recipient_24h'      // 131049
  | 'mark_recipient_unreachable'  // 131026
  | 'block_template'              // 131045
  | 'reduce_batch_size'           // 131048
  | 'backoff_and_retry'           // 131056
  | 'log_only'                    // 131047
  | 'engineering_alert'           // 131051, unknown
  | 'policy_violation_alert'      // 132xxx

export interface ErrorClassification {
  code: string
  action: ErrorAction
  severity: 'info' | 'warn' | 'error' | 'critical'
}

export function classifyErrorCode(code: string | null): ErrorClassification {
  /* see §6 for the table */
}
```

### 2.5 Repository interface

```typescript
// src/domain/repositories/whatsapp-message-repository.ts
export interface WhatsAppMessageRepository {
  insertQueued(message: WhatsAppMessage): Promise<void>
  attachKapsoMessageId(id: string, kapsoMessageId: string): Promise<void>
  findByKapsoMessageId(kapsoMessageId: string): Promise<WhatsAppMessage | null>
  applyStatusUpdate(kapsoMessageId: string, update: StatusUpdate): Promise<WhatsAppMessage | null>
  markFailedNoBspId(id: string, error: { title: string; details?: string }): Promise<void>
}
```

The four-method surface is shaped by what application code actually does:
- `insertQueued` + `attachKapsoMessageId` — the two-phase send (see §4.2).
- `findByKapsoMessageId` — webhook handler lookup, also useful for ops scripts.
- `applyStatusUpdate` — webhook handler update path.
- `markFailedNoBspId` — when the BSP call throws *before* we got an id back.

---

## 3. Repository implementation

File: `src/infrastructure/supabase/repositories/whatsapp-message-repository.ts` + `whatsapp-message-mapper.ts`.

Mirror the existing pattern (`campaign-mapper.ts`, `campaign-repository.ts`): named-export functions, not a class. The mapper converts between the snake_case row shape and the camelCase entity props.

```typescript
// whatsapp-message-mapper.ts
export interface WhatsAppMessageRow {
  id: string
  restaurant_id: string
  member_id: string | null
  campaign_id: string | null
  phone_e164: string
  direction: 'outbound' | 'inbound'
  category: 'marketing' | 'utility' | 'authentication' | 'service'
  message_type: 'text' | 'image' | 'template' | 'interactive'
  template_id: string | null
  template_name: string | null
  content_preview: string | null
  kapso_message_id: string | null
  status: MessageStatus
  error_code: string | null
  // … timestamps
}

export function toEntity(row: WhatsAppMessageRow): WhatsAppMessage { /* … */ }
export function toQueuedRow(m: WhatsAppMessage): InsertRow { /* … */ }
```

```typescript
// whatsapp-message-repository.ts (extracts only)
export async function insertQueuedMessage(m: WhatsAppMessage): Promise<void> {
  const supabase = createServerSupabaseClient()
  const { error } = await supabase.from('whatsapp_messages').insert(toQueuedRow(m))
  if (error) throw new Error(`insertQueuedMessage: ${error.message}`)
}

export async function attachKapsoMessageId(id: string, kapsoMessageId: string): Promise<void> {
  const supabase = createServerSupabaseClient()
  const { error } = await supabase
    .from('whatsapp_messages')
    .update({ kapso_message_id: kapsoMessageId, status: 'sent', sent_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error(`attachKapsoMessageId: ${error.message}`)
}
```

The repository file should stay under the 150-line limit — extract the mapper and any complex query helpers into separate files (mirroring `campaign-mapper.ts` + `campaign-repository.ts`).

---

## 4. Send-side instrumentation strategy

### 4.1 The core problem: BSP wrappers discard the message id

`src/infrastructure/kapso/client.ts:36-40`:

```typescript
try {
  await client.messages.sendText({ phoneNumberId, to, body: text })
} catch (err) {
  console.warn('[Kapso] Error sending message:', (err as Error).message)
}
```

The Kapso SDK returns `SendMessageResponse { messages: [{ id, messageStatus? }] }` (verified in `node_modules/@kapso/whatsapp-cloud-api/dist/types-CheSGKKj.d.ts` lines 16-28). We currently `await` and discard it. Same pattern in `sendImageMessage` and `sendTemplateMessage` (`template-client.ts:140-158`).

We need the id. **Decision**: change the SDK wrapper return types from `Promise<void>` / `Promise<boolean>` to a small typed result, and propagate up.

```typescript
// New: src/infrastructure/whatsapp/messaging-result.ts
export interface SendResult {
  ok: boolean
  kapsoMessageId: string | null
  raw: Record<string, unknown> | null
  error?: { title: string; details?: string }
}
```

Adapter and port both grow this return shape:

```typescript
// src/domain/ports/whatsapp-messaging.ts
export interface WhatsAppMessagingPort {
  sendText(phoneNumberId: string, to: string, text: string): Promise<SendResult>
  sendImage(phoneNumberId: string, to: string, imageUrl: string, caption?: string): Promise<SendResult>
  sendInteractiveButtons(/* … */): Promise<SendResult>
}
```

`sendWhatsAppTemplateMessage` in `src/application/send-template-message.ts:16-41` likewise returns `Promise<SendResult>` instead of `Promise<boolean>`.

This is technically a port change. Existing callers that don't care about the id (`onboard-send-helpers.ts`, language handler replies, `send-test-message.ts`) just ignore the new fields — backwards-compatible at the type level because `SendResult` has no required fields they look at.

### 4.2 Where to insert rows in `execute-campaign-batch.ts`

Two-phase pattern in `sendToMember` (currently at `src/application/execute-campaign-batch.ts:46-72`):

```
1. INSERT whatsapp_messages row with status='queued', kapso_message_id=NULL
2. Call BSP send (sendTextMessage / sendWhatsAppTemplateMessage / sendImageMessage)
3a. On success: UPDATE row SET kapso_message_id=…, status='sent', sent_at=now()
3b. On thrown error: UPDATE row SET status='failed', failed_at=now(), error_title=…
3c. On returned error (BSP non-throw with ok=false): same as 3b
```

#### Why insert *before* the network call

- We want a row even if the process crashes mid-send. Otherwise we have a Meta-side message we cannot correlate.
- The `id` we generate locally is what we store on `failed` rows that never got a `kapso_message_id`.
- The `queued_at` timestamp gives us latency metrics (queued → sent) for free.

#### Atomicity

There is no DB transaction across "insert + HTTP call + update". This is acceptable because:

- The `kapso_message_id` column is `UNIQUE` and **nullable**. A row stuck in `queued` with a NULL kapso id cannot collide with anything.
- A status webhook arriving for a message we haven't yet recorded the kapso id for will simply not find a matching row — webhook handler logs and skips (see §5.4). When step 3a finally lands, we'll have missed the webhook. We can mitigate this by ordering the BSP call to **complete** before we ack the row insert — but the BSP call is what gives us the id, so the order must be: insert → BSP call → update. The race window (BSP returns id and webhook fires before we run the UPDATE) is sub-second; we accept it for this slice and revisit if observed.

#### Where to wire it

The cleanest insertion point is a new helper `recordOutboundSend` invoked from `sendToMember`:

```typescript
// src/application/record-outbound-send.ts (new)
export async function recordOutboundSend(args: {
  restaurantId: string
  memberId: string
  campaignId: string | null
  phoneE164: string
  category: 'marketing' | 'utility' | 'service'
  send: () => Promise<SendResult>
  template?: { id: string; name: string }
  messageType: 'text' | 'image' | 'template'
  contentPreview: string | null
}): Promise<SendResult> { /* insert → call → update */ }
```

`sendToMember` then becomes:

```typescript
const result = await recordOutboundSend({
  restaurantId: ctx.campaign.restaurantId,
  memberId: member.id,
  campaignId: ctx.campaign.id,
  phoneE164: member.phone,
  category: ctx.template?.category === 'MARKETING' ? 'marketing' : 'utility',
  template: ctx.template ? { id: ctx.template.id, name: ctx.template.name } : undefined,
  messageType: ctx.template ? 'template' : 'text',
  contentPreview: couponDescription.slice(0, 120),
  send: () => ctx.template
    ? sendWhatsAppTemplateMessage(/* … */)
    : sendTextMessage(ctx.phoneNumberId, member.phone, couponDescription),
})
```

The `sendCouponQr` helper (image send for the QR code) gets the same wrapper — it's a separate row with `message_type='image'`, `category='service'` (the QR is utility, not marketing).

### 4.3 Backwards compatibility during rollout

- The migration is additive (new table + two new nullable columns). Existing campaigns continue to function with no changes.
- The `recordOutboundSend` helper is the **only** place that writes to `whatsapp_messages`. If the migration hasn't run, the helper logs and continues so prod can't crash on a half-deploy.
- Feature flag: introduce `WAQ_TRACK_MESSAGES=1` env var. When unset, `recordOutboundSend` skips the DB writes and just calls `send()`. Default ON in dev, OFF in prod for the first deploy, then flip ON.
- Per-recipient flag (`pmm_throttled_until`, `unreachable_at`) checks at send time are **not in this slice** — that's WAQ-007. Setting the columns is in scope; reading them gates is not. The columns just sit there populated until WAQ-007 starts honoring them.

### 4.4 Other send paths to instrument

Besides `execute-campaign-batch.ts`, the send paths are:

- `src/application/send-returning-welcome.ts` (welcome campaign)
- `src/application/onboard-send-helpers.ts` (onboarding messages — utility category)
- `src/application/send-test-message.ts` (manual test sends — utility)
- `src/application/__tests__/...` (test paths — N/A)
- All the inbound-handler reply paths in `src/app/api/webhooks/whatsapp/*-handlers.ts` (HELP, POINTS, REWARDS, JOIN replies) — these are utility/service category, all sent via `sendTextMessage`

For this slice we instrument **only the campaign batch path**. The other paths go in a follow-up because:
- Marketing volume is what kills WABA quality, not utility replies.
- Inbound-reply messages are 1:1 with inbound webhooks, so we already have observability via `processed_webhooks`.

This is documented as "WAQ-001 follow-up: instrument utility send paths" — a 0.5d task to add later.

---

## 5. Webhook routing strategy

### 5.1 The discriminator at the top of routing

`src/app/api/webhooks/whatsapp/route.ts:25-44` currently does:

```
parseKapsoWebhook(body, …) → InboundMessage | null
if null → return ignored
else → routeMessage(message, restaurantId, log)
```

`parseKapsoWebhook` returns `null` for any payload that lacks an inbound `messages[]` entry — including all status events. Today they're silently ignored. We split routing **before** parsing:

```typescript
// route.ts (revised flow, illustrative)
const eventKind = classifyWebhookKind(body)  // 'inbound' | 'status' | 'other'
if (eventKind === 'status') {
  await routeStatusEvent(body, restaurantId, log)
  return ack
}
if (eventKind === 'inbound') {
  // existing path: parseKapsoWebhook + routeMessage
}
return ignored
```

`classifyWebhookKind` is a tiny pure function in `src/infrastructure/whatsapp/webhooks.ts`:

```typescript
// Meta format: payload.entry[0].changes[0].value.statuses[]
// Kapso format: payload.message_status or payload.event === 'message_status'
export function classifyWebhookKind(body: unknown): 'inbound' | 'status' | 'other' {
  /* …read both shapes… */
}
```

### 5.2 Status payload shape — what we know

Verified from the Kapso SDK type definitions (`node_modules/@kapso/whatsapp-cloud-api/dist/server.d.ts:21-30`):

```typescript
interface MessageStatusUpdate {
  id: string                  // wamid... (matches whatsapp_messages.kapso_message_id)
  status: string              // 'sent' | 'delivered' | 'read' | 'failed'
  timestamp?: string          // ISO or unix string
  recipientId?: string        // recipient phone, sometimes E.164 sometimes raw digits
  conversation?: Record<string, unknown>
  pricing?: Record<string, unknown>
  errors?: Array<Record<string, unknown>>  // [{ code: number, title: string, error_data: { details: string } }]
  [key: string]: unknown
}
```

The SDK exposes `normalizeWebhook(payload)` which returns `{ statuses: MessageStatusUpdate[], messages: …, calls: … }`. **Decision**: use it.

```typescript
import { normalizeWebhook } from '@kapso/whatsapp-cloud-api/server'

const normalized = normalizeWebhook(body)
for (const status of normalized.statuses) {
  await handleStatusUpdate(status, restaurantId, log)
}
```

This is a cleaner integration than rolling our own parser, and inherits any payload-shape changes Kapso ships in their SDK.

#### Open question — needs Kapso confirmation

The SDK type declares `errors` as `Array<Record<string, unknown>>` — the inner shape is not typed. The Meta documentation describes the shape as `{ code, title, error_data: { details } }`, but Kapso's proxy might wrap or rename. **Action before merge**: dev sandbox-test by triggering a `131049` against a test recipient and capturing the actual normalised payload. The defensive design (raw JSONB column + flexible classifier) means we won't break if shape differs slightly — we just lose typed access.

### 5.3 Idempotency strategy

The current implementation (`route.ts:108-127`) keys idempotency on the inbound `message.messageId` (which is the `wamid...`). Status events arrive **multiple times for the same `wamid`** (sent → delivered → read), so we cannot key on `wamid` alone.

**Decision**: idempotency key for status events is `kapsoMessageId + ':' + status`. So `wamid.ABC:sent`, `wamid.ABC:delivered`, etc. — three rows in `processed_webhooks` per fully-delivered message.

This costs us ~3x rows in `processed_webhooks` for outbound traffic. That table currently holds inbound webhooks only and has no retention. Action item: §8 risks.

```typescript
const idempotencyKey = `${status.id}:${status.status}`
const dup = await tryMarkProcessed(idempotencyKey, log)
if (dup) return  // already handled this transition
```

### 5.4 Status handler implementation sketch

```typescript
// src/app/api/webhooks/whatsapp/status-handlers.ts (new)
export async function handleStatusUpdate(
  status: MessageStatusUpdate,
  restaurantId: string,
  log: LogFn
): Promise<void> {
  const idempotencyKey = `${status.id}:${status.status}`
  if (await alreadyProcessed(idempotencyKey)) return

  const message = await findByKapsoMessageId(status.id)
  if (!message) {
    log('warn', 'status.unknown_message', { kapsoMessageId: status.id })
    // Race window: BSP id arrived before our UPDATE landed (§4.2).
    // We DO NOT mark this idempotency key as processed — we want the retry.
    return
  }

  const update = mapStatusUpdate(status)  // Kapso shape → domain StatusUpdate
  const updated = await applyStatusUpdate(status.id, update)

  if (updated?.snapshot.status === 'failed' && updated.snapshot.errorCode) {
    await dispatchErrorAction(updated, restaurantId, log)  // §6
  }

  await markProcessed(idempotencyKey)
}
```

The route-level `routeStatusEvent` helper iterates `normalized.statuses` and calls `handleStatusUpdate` for each.

---

## 6. Error code dispatch (WAQ-003)

### 6.1 The dispatch table

Implemented as a pure function `classifyErrorCode` in `src/domain/value-objects/whatsapp-error-code.ts`. The action enum drives the dispatcher in `src/application/dispatch-error-action.ts`.

| Code   | Meaning                                | Action                                             | Mutation                          | Alert                |
|--------|----------------------------------------|----------------------------------------------------|-----------------------------------|----------------------|
| 131049 | Per-user marketing limit (PMM) hit     | `throttle_recipient_24h`                           | `members.pmm_throttled_until = now()+24h` | If rate spikes      |
| 131026 | Recipient cannot receive               | `mark_recipient_unreachable`                       | `members.unreachable_at = now()`  | No                   |
| 131045 | Template not approved                  | `block_template`                                   | None on `members`. Mark template unsendable. | Tenant + ops |
| 131047 | Template message expired (24h passed)  | `log_only`                                         | None                              | No                   |
| 131048 | Too many recipients                    | `reduce_batch_size`                                | None                              | Ops (config bug)     |
| 131051 | Unsupported message type               | `engineering_alert`                                | None                              | Platform (bug)       |
| 131056 | Pair rate limit                        | `backoff_and_retry`                                | None                              | Only if persistent   |
| 132xxx | Template-specific / policy violation   | `policy_violation_alert`                           | None on `members`                 | Platform team        |
| (any)  | Unknown                                | `engineering_alert`                                | None                              | Platform             |

Source: `docs/playbooks/dev-shared-waba-safeguards.md:289-300`. The 131045 block-template behavior is "mark the template as `BLOCKED` and notify". We have a `whatsapp_templates.status` column already (migration 009); we can add `'BLOCKED'` to the allowed values in a follow-up. For this slice, 131045 just logs + alerts.

### 6.2 Dispatcher

```typescript
// src/application/dispatch-error-action.ts
export async function dispatchErrorAction(
  message: WhatsAppMessage,
  restaurantId: string,
  log: LogFn
): Promise<void> {
  const classification = classifyErrorCode(message.snapshot.errorCode)

  switch (classification.action) {
    case 'throttle_recipient_24h':
      if (message.snapshot.memberId) {
        await throttleMemberPmm(message.snapshot.memberId, hours(24))
      }
      break
    case 'mark_recipient_unreachable':
      if (message.snapshot.memberId) {
        await markMemberUnreachable(message.snapshot.memberId)
      }
      break
    case 'block_template':
    case 'engineering_alert':
    case 'policy_violation_alert':
      await emitOpsAlert({ kind: classification.action, message, restaurantId })
      break
    case 'reduce_batch_size':
    case 'backoff_and_retry':
    case 'log_only':
      break  // logging happens unconditionally below
  }

  log(classification.severity, 'whatsapp.error_dispatched', {
    code: classification.code,
    action: classification.action,
    restaurantId,
    kapsoMessageId: message.snapshot.kapsoMessageId,
  })
}
```

`throttleMemberPmm`, `markMemberUnreachable` are new functions in `member-repository.ts` — single-column updates scoped to (memberId, restaurantId).

`emitOpsAlert` is a thin wrapper. **For this slice**, it writes to `events` (`type='whatsapp_error'`, `data_json={code, action, kapsoMessageId}`) and `console.error`s. Real Slack/email integration is WAQ-009. The events row is the audit trail until then.

### 6.3 What we explicitly *don't* do here

- No tenant-level auto-pause on accumulated 131049s — that's WAQ-009.
- No `tenant_quality_state` table (described in playbook §3.2) — that's WAQ-006.
- No template `BLOCKED` status flip on 131045 — follow-up.
- No retry queue for `131056` — we just log; the campaign send already swallows BSP errors silently (existing behavior at `client.ts:38-40`).

---

## 7. Test strategy

Tests are co-located in `__tests__/` next to source, matching the project pattern (`src/application/__tests__/*.test.ts`, etc.). Vitest is configured via `vitest.config.ts`.

### 7.1 Domain tests (zero deps, fast)

| File | Covers |
|------|--------|
| `src/domain/value-objects/__tests__/message-status.test.ts` | `isProgression` lattice; `failed` is terminal; out-of-order transitions reject |
| `src/domain/value-objects/__tests__/whatsapp-error-code.test.ts` | Every code in §6.1 returns the documented action; unknown → `engineering_alert`; 132xxx → `policy_violation_alert` |
| `src/domain/entities/__tests__/whatsapp-message.test.ts` | `queue` constructs a valid queued message; `applyStatusUpdate` honors `isProgression`; failed retains error fields |

### 7.2 Application tests

| File | Covers |
|------|--------|
| `src/application/__tests__/record-outbound-send.test.ts` | Insert → call → update happy path; insert + thrown send → row marked failed with error; insert + ok=false → same; flag-off short-circuits |
| `src/application/__tests__/dispatch-error-action.test.ts` | 131049 → `throttleMemberPmm` called with +24h; 131026 → `markMemberUnreachable`; 132xxx → `emitOpsAlert` only; unknown code → `emitOpsAlert` |
| `src/application/__tests__/execute-campaign.test.ts` | (extend existing) — `sendInBatches` calls `recordOutboundSend` per member; failures don't abort the batch; row count matches member count |

Mock pattern matches `execute-campaign.test.ts:1-82`: `vi.mock` each repository with named exports, build a `Campaign` and `Member` factory, assert spy calls.

### 7.3 Webhook integration test

This is the one E2E test the user explicitly asked for.

`src/app/api/webhooks/whatsapp/__tests__/route.status-event.integration.test.ts`:

1. `POST /api/webhooks/whatsapp` with a Kapso-shaped status payload (synthetic, `status='delivered'` for a known `kapsoMessageId`).
2. Pre-seed the `whatsapp_messages` row (status `sent`).
3. Assert the row updates to `delivered`, `delivered_at` is set, and `processed_webhooks` has the `wamid:delivered` key.
4. Re-POST identical payload — assert duplicate response, no second update.
5. POST a `failed` payload with `errors[0].code = 131049` and a `member_id` — assert `members.pmm_throttled_until` is set ~24h in the future.

This needs the test Supabase instance (the test already sets up tables in `vitest.config.ts` setup). The signature-verification short-circuits when `KAPSO_WEBHOOK_SECRET` is absent (`route.ts:88-106`), so we don't need to sign the payload in tests.

### 7.4 What we don't test in this slice

- Real Kapso end-to-end — needs a sandbox account and is explicitly deferred to the WAQ-002 sandbox validation step (§5.2 open question).
- Load testing of the cooldown index — that's a WAQ-007 concern. We size the indexes correctly but defer benchmarking.

---

## 8. Risks and open questions

### 8.1 Kapso outbound status payload — needs confirmation (HIGH)

**Status**: SDK type declares `MessageStatusUpdate.errors: Array<Record<string, unknown>>`. The Meta documented inner shape is `{ code, title, error_data: { details } }`. Kapso may wrap or rename.

**Mitigation**:
1. Day 1 of WAQ-002: sandbox-test by sending to an invalid number, capture the actual webhook payload, confirm the `errors[0].code` field path.
2. Defensive design: `whatsapp_messages.raw_status_payload JSONB` always stores the full payload, so even if our parser misses fields we can backfill from the raw column.
3. Classifier is permissive: an unrecognised code shape returns `engineering_alert`, not a crash.

**If Kapso has not documented this**: file a support ticket on the same day. Block WAQ-002 day-2 until we have a real payload sample.

### 8.2 Volume implications

Estimate at the time of this design (single tenant, marketing-heavy, "hundreds of contacts"):
- Hundreds of contacts × 2-3 marketing sends/week = ~2,000 outbound rows/month per tenant.
- Each row gets 3-4 status webhooks (sent, delivered, read, optional failed) = ~8,000 `processed_webhooks` rows/month per tenant.
- At 5 production tenants, ~50,000 `processed_webhooks` rows/month, ~10,000 `whatsapp_messages` rows/month. Both are negligible for Postgres.

**Where it bites**: at 50 tenants and full scale (tier_10k territory), 5M `whatsapp_messages` rows/year. Indexes designed in §1.1.2 cover the read patterns; the partial indexes on `WHERE x IS NOT NULL` keep size in check. Action item for WAQ-008: add a retention policy (archive `read`/`failed` rows older than 90 days to a cold table). Out of scope here.

**`processed_webhooks` retention**: that table has no retention today (it's been growing since 001). Adding outbound traffic accelerates the growth. Action item: open a follow-up `WAQ-OPS-001 — processed_webhooks 30-day retention sweep` ticket. Not blocking for this slice.

### 8.3 Race: BSP returns wamid before we've UPDATEd the row

Described in §4.2. We accept the sub-second window. Mitigation: webhook handler logs `status.unknown_message` and *does not* mark the idempotency key processed, so Kapso's normal retry will deliver the event again 30s-2min later when our row is fully written.

### 8.4 What if `member_id` is null at status time?

Possible if a member was deleted between send and status webhook. The dispatcher's `if (memberId)` guard handles it: 131049/131026 just logs without a member mutation. The row still gets `status='failed'`, so analytics are accurate.

### 8.5 Surprising findings during investigation

- `src/infrastructure/kapso/client.ts` swallows all BSP errors (`console.warn`, no throw, no return value). This silently hides send failures from the campaign loop today. With the new `SendResult` shape, the campaign batch will at least see `ok=false` and record a failed row — a real improvement over today's blind spot.
- The existing `src/domain/repositories/` directory does not exist (interfaces are de-facto the named exports of repository files). We introduce it for `WhatsAppMessageRepository` only; we do not refactor existing repos.
- `whatsapp_templates` table (migration 009) already has `category` (`MARKETING|UTILITY|AUTHENTICATION`). We can derive `whatsapp_messages.category` from `template.category` for template sends; for plain text sends we default to `service` (utility-like, no PMM concern).

---

## 9. Recommended implementation order (6 days)

Sequence prioritises (a) shipping the migration first so prod is forward-compatible, (b) keeping the send instrumentation behind a feature flag until we've validated the webhook side end-to-end.

### Day 1 — schema + domain (WAQ-001 part A)
- Migration 035 (`whatsapp_messages` + indexes + RLS).
- Migration 036 (`members.pmm_throttled_until`, `members.unreachable_at` + indexes).
- Domain entities, value objects, repository interface — pure unit-tested, no infra.
- **Checkpoint**: migrations applied to dev DB, domain tests green.

### Day 2 — repository + send instrumentation (WAQ-001 part B)
- Mapper + Supabase repository (`whatsapp-message-repository.ts`).
- Change `WhatsAppMessagingPort` and Kapso adapters to return `SendResult`.
- New helper `recordOutboundSend`.
- Wire into `execute-campaign-batch.ts` behind `WAQ_TRACK_MESSAGES` flag.
- Tests: `record-outbound-send.test.ts`, extend `execute-campaign.test.ts`.
- **Checkpoint**: feature flag OFF in prod; ON in dev — manually trigger a campaign in dev, verify rows appear with `status='sent'`.

### Day 3 — webhook routing (WAQ-002 part A)
- `classifyWebhookKind` discriminator.
- Sandbox-test against Kapso — confirm payload shape (resolves §8.1).
- `routeStatusEvent` + `handleStatusUpdate`.
- Idempotency key change: `kapsoMessageId:status`.
- Integration test for the route.
- **Checkpoint**: in dev, send a campaign + observe `delivered`/`read` updates within seconds.

### Day 4 — webhook polish (WAQ-002 part B)
- `findByKapsoMessageId` race handling (don't mark processed when row missing).
- Telemetry: ensure all status transitions log structured events (`webhook.status_received`, `webhook.status_unknown_message`).
- Documentation update: `docs/playbooks/dev-shared-waba-safeguards.md` §4.1 — link to actual implementation files.
- **Checkpoint**: feature flag flipped ON in prod for the existing Green Kitchen tenant only. Watch for 24h.

### Day 5 — error code dispatch (WAQ-003 part A)
- `classifyErrorCode` + the table from §6.1.
- `dispatchErrorAction` with the action switch.
- `throttleMemberPmm` + `markMemberUnreachable` repository helpers.
- `emitOpsAlert` writing to `events`.
- Tests for every error code branch.
- **Checkpoint**: synthetic webhook with each error code → correct member mutation.

### Day 6 — integration + handoff (WAQ-003 part B)
- E2E sandbox: trigger 131049 from Kapso sandbox, confirm `pmm_throttled_until` set.
- Update kanban: WAQ-007 explicitly references the `pmm_throttled_until` column.
- Add follow-up tickets: utility send-path instrumentation, `processed_webhooks` retention, template `BLOCKED` status.
- Final review against this design doc.

### Why not "migration last"

Migrations are by far the lowest-risk artifact (no behavior change until application code reads/writes). Putting them first means every subsequent day can branch off `develop` cleanly without database-state coordination across PRs.

---

## 10. Boundaries — explicitly out of scope

- **WAQ-004** (`consent_records`) — blocked by Q1, designed in next iteration.
- **WAQ-005** (STOP keyword → consent) — blocked by Q2, designed with WAQ-004.
- **WAQ-006** (quality polling, `tenant_quality_state`) — separate slice.
- **WAQ-007** (cooldown enforcer) — uses the column we add here, but the read-side gate is its own slice.
- **WAQ-008+** — explicitly deferred.
- **MBL-*** (multi-brand sprint) — untouched.
- **No refactor** of existing repositories to use interface-first DI. We add an interface only for the new repository.
- **No retry / queue / scheduled job** in this slice. All work is synchronous within the webhook request or the existing campaign batch loop.
- **No template `BLOCKED` status** — 131045 alerts but does not modify the template row in this slice.
- **No tenant-level alerting integration** (Slack/email/PagerDuty). Alerts are `events` rows + `console.error`; WAQ-009 wires the real channel.

---

## 11. Acceptance criteria (for the architect's checkpoint review)

WAQ-001 done when:
- Migration 035 applied; `whatsapp_messages` table exists with all listed columns, indexes, RLS.
- Migration 036 applied; `members` columns + indexes exist.
- A campaign send in dev produces one `whatsapp_messages` row per recipient, with `status='sent'` and a non-null `kapso_message_id`.
- `WAQ_TRACK_MESSAGES=0` cleanly disables tracking with no test failures.

WAQ-002 done when:
- A status webhook for an existing `kapso_message_id` updates the row's status and timestamp.
- Repeated identical webhooks no-op (idempotency key working).
- Unknown `kapso_message_id` logs but does not 500.
- Integration test passes.

WAQ-003 done when:
- 131049 sets `members.pmm_throttled_until` ~24h ahead.
- 131026 sets `members.unreachable_at`.
- 132xxx writes an `events` row with `type='whatsapp_error'` and `data_json.action='policy_violation_alert'`.
- All seven listed codes have unit-test coverage in `dispatch-error-action.test.ts`.
