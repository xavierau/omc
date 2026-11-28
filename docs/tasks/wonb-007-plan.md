# WONB-007 — Inbound-first opt-in flow (Strategy A backend)

**Branch:** `feature/wonb-007` · **No DDL**
**Playbook ref:** `docs/playbooks/staff-number-onboarding-and-marketing.md` §6.2 Strategy A
**Estimate:** 3d · **Depends on:** WONB-005 ✅, WONB-004 ✅ (both merged on develop)

## Goal
First inbound from a phone with no active strong-marketing consent triggers an automatic opt-in confirmation template inside the just-opened 24h window. On YES reply → upgrade to `grade='strong', status='opted_in'`. On NO → revoke. Zero marketing template ever sent to a non-consented phone.

## Locked decisions (user-approved)
| # | Decision |
|---|---|
| Q-C | Inbound from a member with weak/none consent triggers confirmation prompt automatically. 7-day cooldown to avoid re-prompting during the pending window. |
| Q-D | Tenant-configurable confirmation template via `tenant_campaign_settings.optin_confirmation_template_id` (nullable). Falls back to platform default via env var `KAPSO_DEFAULT_OPTIN_TEMPLATE_ID`. **For MVP: every tenant uses the platform default.** UI to set tenant override is out of scope. |
| Q-E | YES keyword case-insensitive, multi-lang (`YES`, `Y`, `是`, `確認`, `確定` — already in `command-keywords.ts`). Post-window YES still upgrades consent silently (no reply). 7-day pending TTL (cleanup is WONB-009). |
| Q-F | Gate on (no pending in 7d) AND (no strong consent) AND (not a recognised system command) AND (member exists). `isSystemKeyword` is interpreted operationally as "any route other than `unknown`" — JOIN / STOP / HELP / POINTS / REWARDS / REDEEM and YES / NO all count as system keywords for this gate. |
| Q-G | Receipt confirmation wins YES. Opt-in confirmation only triggers if no pending receipt. |

## Acceptance criteria
1. First inbound from a phone with no active strong-marketing consent → automatic opt-in confirmation template send inside the just-opened 24h window.
2. Send gated by 5 conditions: `isSystemKeyword=false`, `existingMember!=null`, no `opted_in/strong` consent, no `opted_out` consent, no `pending` consent in last 7 days.
3. On YES reply → existing `pending` row upgraded via `upgradeToOptedIn` (added in WONB-005). Status flips `pending → opted_in`. Grade was `strong` at pending insert time — no grade change needed.
4. On NO reply → pending row revoked via existing `revokeConsent` use case.
5. No reply within 7 days → row remains until WONB-009 cron sweeps. Future inbounds during this window do NOT re-prompt.
6. Existing JOIN flow unchanged.
7. Receipt-confirmation YES handler runs first (Q-G); opt-in confirmation only triggers if no pending receipt.
8. Zero marketing template sent to a non-consented phone — verified by code-read of every send path.
9. `events.consent_granted` emitted on YES upgrade with `data_json={ source: 'inbound_first_optin' }`.
10. `events.consent_revoked` emitted on NO with `data_json={ source: 'inbound_first_optin_rejected' }`.
11. The opt-in prompt runs **alongside** existing `dispatchRoute` (not instead of). E.g. an unknown text inbound triggers both `handleUnknown` and the opt-in prompt.

## Domain — `should-prompt-optin.ts`

Pure decision function:
```typescript
function shouldPromptOptin(input: {
  existingMember: Member | null
  activeMarketingConsent: ConsentRecord | null
  recentPendingConsent: ConsentRecord | null
  isSystemKeyword: boolean
  now?: Date
}): { prompt: boolean; reason?: 'system_keyword' | 'has_strong_consent' | 'recent_pending' | 'opted_out' | 'no_member' }
```

Decision tree (matches Q-C):
```
if isSystemKeyword       → no, reason=system_keyword
if existingMember==null  → no, reason=no_member         (existing JOIN flow handles new members)
if active.status='opted_in' && grade='strong' → no, reason=has_strong_consent
if active.status='opted_out' → no, reason=opted_out
if pending && (now - capturedAt) < 7d → no, reason=recent_pending
otherwise → yes
```

## Application — 3 use cases

### `prompt-marketing-optin.ts`
```typescript
async function promptMarketingOptin(input: {
  restaurantId: string
  phoneE164: string
  source: string  // typically `inbound_first_${messageId}`
}): Promise<{ promptSent: boolean; reason?: string }>
```
1. Resolve member by phone.
2. Resolve active marketing consent.
3. Resolve any pending consent < 7 days old.
4. Call `shouldPromptOptin`. If `prompt=false`, return `{ promptSent: false, reason }`.
5. **Insert `consent_records(status='pending', grade='strong')`** — initialise grade at pending time so upgrade is a pure status flip.
6. Resolve confirmation template: tenant override on `tenant_campaign_settings.optin_confirmation_template_id` if set, else `KAPSO_DEFAULT_OPTIN_TEMPLATE_ID` env var.
7. Send template via existing messaging infra (find the existing template-send adapter).
8. Return `{ promptSent: true }`.

### `confirm-marketing-optin.ts`
```typescript
async function confirmMarketingOptin(input: {
  restaurantId: string
  phoneE164: string
}): Promise<{ upgraded: boolean }>
```
1. Call `consentRecordRepository.upgradeToOptedIn` (added in WONB-005). Returns `boolean` (true if pending row upgraded).
2. If upgraded, emit `consent_granted` event with `data_json={ source: 'inbound_first_optin' }` and `granted_at=now()` already stamped by repo.
3. Return `{ upgraded }`.

**Reusable by WONB-008** for the reconfirmation YES path.

### `reject-marketing-optin.ts`
```typescript
async function rejectMarketingOptin(input: {
  restaurantId: string
  phoneE164: string
}): Promise<{ revoked: boolean }>
```
1. Find pending consent row.
2. Call existing `revokeConsent` (or equivalent).
3. Emit `consent_revoked` event with `data_json={ source: 'inbound_first_optin_rejected' }`.
4. Return.

## Webhook handler integration

### Modify `src/app/api/webhooks/whatsapp/handlers.ts`

After `bumpServiceWindow` and BEFORE `dispatchRoute`, insert:
```typescript
// WONB-007: maybe send opt-in prompt for first qualifying inbound.
// Side-effect alongside dispatchRoute (not replacement).
await maybePromptOptin(message, restaurantId, log)
```

`maybePromptOptin` is in a new file `src/app/api/webhooks/whatsapp/optin-prompt.ts`:
- Filters by `isSystemKeyword(message)` (use existing `route-resolver.ts::resolveRoute`).
- Calls `promptMarketingOptin`.
- Logs success/skip.
- **Never throws** (matches `bumpServiceWindow` non-fatal pattern). Errors logged, not propagated.

### Modify `src/app/api/webhooks/whatsapp/handlers.ts::dispatchConfirmation`

Extend to handle YES/NO for opt-in:
```typescript
async function dispatchConfirmation(ctx, route: 'YES' | 'NO' | null) {
  // 1. Receipt confirmation (existing) — wins YES.
  const receiptHandled = await handleReceiptConfirmation({...})
  if (receiptHandled) return

  // 2. WONB-007 opt-in.
  if (route === 'YES') {
    const optinHandled = await handleOptinConfirmation(ctx)
    if (optinHandled) return
  } else if (route === 'NO') {
    const rejectHandled = await handleOptinRejection(ctx)
    if (rejectHandled) return
  }

  // 3. Fall through.
  return handleUnknown(...)
}
```

`handleOptinConfirmation` and `handleOptinRejection` live in new file `src/app/api/webhooks/whatsapp/optin-confirmation.ts`. Each:
- Calls the matching use case
- Returns `true` only if the use case actually upgraded/revoked (use case returns `{ upgraded/revoked: boolean }`)
- Sends a free-text reply if window is open (e.g. "Thanks! You'll receive offers." / "Got it, no offers will be sent.")

## Configuration
- Env var `KAPSO_DEFAULT_OPTIN_TEMPLATE_ID` — read at runtime by `prompt-marketing-optin`. Document in seed doc.
- DB: column `tenant_campaign_settings.optin_confirmation_template_id` already nullable from prior migrations? **Verify** — if not present, add as part of WONB-007 (single ADD COLUMN nullable; tiny migration 049). Otherwise reuse.

## File plan

### Create
- `src/domain/services/should-prompt-optin.ts` (≤30 LoC)
- `src/domain/services/__tests__/should-prompt-optin.test.ts` (table-driven, 5 reasons + happy)
- `src/application/prompt-marketing-optin.ts` (≤80 LoC)
- `src/application/__tests__/prompt-marketing-optin.test.ts`
- `src/application/confirm-marketing-optin.ts` (≤40 LoC)
- `src/application/__tests__/confirm-marketing-optin.test.ts`
- `src/application/reject-marketing-optin.ts` (≤40 LoC)
- `src/application/__tests__/reject-marketing-optin.test.ts`
- `src/app/api/webhooks/whatsapp/optin-prompt.ts` (≤60 LoC, the `maybePromptOptin` wrapper)
- `src/app/api/webhooks/whatsapp/optin-confirmation.ts` (≤80 LoC, `handleOptinConfirmation` + `handleOptinRejection`)
- `src/app/api/webhooks/whatsapp/__tests__/optin-prompt.test.ts`
- `src/app/api/webhooks/whatsapp/__tests__/optin-confirmation.test.ts`
- `src/app/api/webhooks/whatsapp/__tests__/route.opt-in-prompt.integration.test.ts`

### Modify
- `src/app/api/webhooks/whatsapp/handlers.ts` — insert `maybePromptOptin` call + extend `dispatchConfirmation`
- (If `tenant_campaign_settings.optin_confirmation_template_id` doesn't exist) `supabase/migrations/049_optin_template.sql`

## Test plan (TDD strictly)
- Domain: `should-prompt-optin` table-driven (6 cases — 5 reasons + happy)
- Use cases (mock all ports):
  - `prompt-marketing-optin`: happy inserts pending + sends template; each gate fails → skip with reason
  - `confirm-marketing-optin`: pending upgraded; already opted_in is no-op (idempotent — tested in WONB-005, just regression here)
  - `reject-marketing-optin`: pending revoked
- Integration:
  - First inbound from a paper-list-shell triggers prompt
  - Second inbound (same phone, within 7d) does NOT re-prompt
  - YES upgrades; NO revokes
  - YES after 24h window expired: still upgrades silently (no reply send)
  - JOIN keyword inbound: existing flow runs, opt-in prompt skipped (system_keyword reason)
  - Image inbound: skipped (system_keyword)
  - Pending receipt + pending optin + YES: receipt handled, optin remains pending
  - Concurrent webhook retries (same phone, 100ms apart): only one pending row inserted (existing partial-unique on consent_records guards)
  - `KAPSO_DEFAULT_OPTIN_TEMPLATE_ID` not set: log error, skip prompt, keep service window
  - Member opted_out 30d ago: no prompt
  - Pending row from a future WONB-008 reconfirmation campaign exists: don't double-prompt

## Out of scope (other backlog items)
- **Tenant-configurable template UI** — column reserved/added; UI to set it deferred to a follow-up
- **Pending-prompt cleanup cron** → WONB-009 (post-launch)
- **QR PDF generator** → WONB-006 (post-launch)
- **Stale-consent expiry** → WONB-009 (post-launch)
- **Re-confirmation campaign** → WONB-008 (next task)
