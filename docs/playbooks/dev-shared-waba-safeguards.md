# Developer Playbook — Shared WABA Safeguards

Audience: OhMyClient engineering team (backend + frontend)
Purpose: Engineering requirements to protect our shared WhatsApp Business Account from per-tenant quality incidents. Without these, a single tenant's bad campaign can drag down delivery and tier for every tenant on the same WABA.

---

## 1. Architecture context

Meta enforces messaging limits and quality at the **Business Portfolio (WABA) level**, not per phone number:

- All numbers in our WABA share the highest achieved messaging tier.
- Quality drop on any one number degrades the portfolio's reputation.
- Meta re-evaluates quality every 6 hours.
- A "Flagged" status freezes tier upgrades and may cause a tier *downgrade* across the WABA.

In addition, Meta enforces a **per-user marketing limit (PMM)**: a dynamic cap on how many marketing templates *any* WhatsApp user receives across all businesses, based on the user's recent open rates and inbox saturation. Breaching it returns error code `131049`.

**Our blast radius:** any tenant who sends spammy, unwanted, or unconsented marketing messages can lower the entire WABA's quality and degrade delivery for every other tenant.

This playbook is the engineering response to that risk.

---

## 2. Components to build (priority order)

| # | Component | Priority | Owner |
|---|---|---|---|
| 1 | Opt-in consent storage + import gate | P0 | Backend |
| 2 | Webhook handler for `131049` and block/spam events | P0 | Backend |
| 3 | Per-user marketing cooldown enforcer | P0 | Backend |
| 4 | Per-tenant daily blast budget | P0 | Backend |
| 5 | Quality polling job + tenant-level auto-pause | P1 | Backend |
| 6 | Template approval queue (first 90 days) | P1 | Backend + Frontend |
| 7 | Quality dashboard (admin + tenant view) | P1 | Frontend |
| 8 | Multi-WABA routing (if we isolate marketers) | P2 | Backend |

---

## 3. Data model additions

Sketch only — final schema designed by `solution-architect`. Names will follow project conventions.

### 3.1 `consent_records`
Source of truth for opt-in proof. One row per (contact, tenant, message_category).

```
id
tenant_id           -- which tenant the consent is for
contact_id          -- our internal contact id
phone_e164          -- denormalised for fast lookup
category            -- 'marketing' | 'utility' | 'authentication'
status              -- 'opted_in' | 'opted_out' | 'pending'
source              -- 'web_form' | 'pos_checkout' | 'qr_landing' | 'imported_csv' | 'whatsapp_button'
source_reference    -- url, form id, csv hash, button payload — must be identifiable
business_name_shown -- the exact business name the user saw when consenting
captured_at
revoked_at          -- when they opted out
captured_ip         -- if web-collected
captured_user_agent -- if web-collected
```

Rules:
- Imports without `source` + `source_reference` + `business_name_shown` are rejected.
- Sending a marketing template without an `opted_in` row for `category='marketing'` is rejected at the application layer.
- An inbound `STOP` / opt-out message flips `status='opted_out'` and stamps `revoked_at`.

### 3.2 `tenant_quality_state`
One row per tenant (or per phone number, if a tenant has multiple).

```
tenant_id
phone_number_id
quality_rating         -- 'green' | 'yellow' | 'red' | 'unknown'
messaging_tier         -- 'tier_250' | 'tier_1k' | 'tier_10k' | 'tier_100k' | 'unlimited'
last_polled_at
flagged                -- bool
auto_paused            -- bool, set true when our auto-pause logic triggers
auto_paused_reason
auto_paused_at
```

### 3.3 `marketing_send_log`
Append-only log of every marketing template send. Used by the cooldown enforcer.

```
id
tenant_id
contact_id
phone_e164
template_name
category
status              -- 'queued' | 'sent' | 'delivered' | 'read' | 'failed'
error_code          -- e.g. 131049
sent_at
window_open_until   -- if sent inside a 24h customer service window
```

### 3.4 `template_review_queue`
For new tenants in their first 90 days, no marketing send until a human approves the template + audience.

```
id
tenant_id
template_name
target_audience_size
target_audience_query
content_preview
submitted_by
submitted_at
reviewed_by
reviewed_at
status              -- 'pending' | 'approved' | 'rejected' | 'changes_requested'
review_notes
```

---

## 4. Webhook event handling

We get webhooks from Kapso (which proxies Meta). Critical events to handle, beyond what we already do:

### 4.1 Message delivery / status webhook
Already partially handled. Add:

- **`error_code = 131049`** (per-user marketing limit hit):
  - Mark the contact as `pmm_throttled_until = now() + 24h`.
  - The cooldown enforcer skips contacts in this state on next campaign.
  - Increment a tenant-level counter; alert ops if the rate spikes (signal of a bad list).

- **`error_code = 131026`** (recipient cannot receive — number blocked, not on WhatsApp, or other):
  - Mark the contact as `unreachable` and skip future sends.

- **`status = failed`** with policy-violation error codes:
  - Log to `tenant_quality_state` history.
  - Alert ops immediately if frequency exceeds threshold.

### 4.2 Account/quality update webhook (if Kapso forwards)
- Update `tenant_quality_state.quality_rating`.
- If transitioning green → yellow: warn the tenant in dashboard, throttle to 50% of normal volume.
- If transitioning to red: auto-pause the tenant, notify CS, notify platform team.

### 4.3 Inbound message webhook
- Already handled for inbox.
- Add: detect opt-out keywords (`STOP`, `UNSUBSCRIBE`, `取消訂閱`, etc.) → flip `consent_records.status` to `opted_out`.
- Inbound message also opens a 24h customer service window — track this on a `conversation_window` table so the cooldown enforcer knows marketing sent in this window does not count toward PMM.

---

## 5. Quality polling job

A background job (cron / queue worker) that polls Meta's WABA quality endpoints via Kapso every 30 minutes for each active phone number.

Pseudocode:

```
for each phone_number in active_numbers:
  state = fetch_quality_from_kapso(phone_number)
  prev = load_tenant_quality_state(phone_number)
  if state.quality_rating != prev.quality_rating:
    record_transition(phone_number, prev, state)
    if state.quality_rating == 'red':
      auto_pause_tenant(phone_number.tenant_id, reason='quality_red')
      notify_platform_team(phone_number, state)
    elif state.quality_rating == 'yellow':
      throttle_tenant(phone_number.tenant_id, factor=0.5)
      notify_cs(phone_number)
  save(state)
```

Cooldown of polling: 30 min is enough — Meta only re-evaluates every 6h.

---

## 6. Per-user cooldown enforcer

Runs at send time, not import time. Before any marketing template is sent:

```
def can_send_marketing(tenant_id, contact_id):
  if contact has consent_records(category='marketing', status='opted_in') == false:
    return reject('no_consent')
  if contact.pmm_throttled_until > now():
    return reject('pmm_throttled')
  if recent_sends_count(contact_id, last_24h, category='marketing') >= 2:
    return reject('cooldown')
  if inside_customer_service_window(tenant_id, contact_id):
    return allow('inside_24h_window')   -- doesn't count toward PMM
  return allow('normal')
```

The `>= 2 in 24h` is our internal cap, intentionally below whatever Meta's dynamic PMM limit currently is. Configurable per tenant (some tenants may need 1, some can go to 3).

---

## 7. Per-tenant daily blast budget

Each tenant has:
- `daily_marketing_cap` (default: max(50, 5% of opted_in_contact_count) for new tenants)
- `daily_marketing_sent_count` (resets at midnight tenant-local timezone)

On each marketing send, increment counter. When `sent_count >= cap`, reject further sends with a clear error in the dashboard.

Cap grows with phase:
- Probe (Days 1-3): 100
- Build (Days 4-7): 500
- Scale (Weeks 2-3): 5,000
- Full (Week 4+): tier_limit

CS staff can advance the phase manually (via admin UI), gated on quality being green.

---

## 8. Auto-pause / kill switch

Two levels:

1. **Soft pause (throttle)**: tenant's daily cap halved, no new marketing campaigns can start, in-flight campaign continues at reduced rate. Triggered by: yellow quality.
2. **Hard pause**: all queued marketing sends cancelled. New sends rejected. Inbound messages and utility/authentication still work. Triggered by: red quality, or repeated `131049`/policy errors above threshold, or manual switch.

Hard pause must be reversible only by platform admin, not by the tenant or CS staff.

---

## 9. Template approval queue (first 90 days)

For any tenant in their first 90 days post-onboarding, marketing template campaigns must be reviewed before send.

Workflow:
1. Tenant or CS staff drafts a campaign in the UI.
2. System creates a `template_review_queue` row, status `pending`.
3. CS or platform reviewer evaluates: opt-in coverage, content quality, audience size, time of day, segmentation.
4. Reviewer approves, requests changes, or rejects.
5. Only on `approved` does the campaign become eligible for send.

After 90 days with green quality and no incidents, the tenant is auto-promoted to "trusted" and reviews are no longer required (or only spot-checked).

---

## 10. Multi-WABA routing (if we isolate high-risk tenants)

If the platform team decides to spin up a second WABA for marketing-heavy tenants:

- Add `waba_id` to `tenants` table.
- Webhook routing must dispatch by phone number → tenant → WABA.
- Send routing: pick the right Kapso webhook secret + business account id per WABA.
- Quality polling job runs per WABA.
- Admin dashboard segregates view per WABA.

This is a P2 architectural change; only do it if the strategic decision is made to physically isolate high-risk tenants. See the original research note for the trade-offs.

---

## 11. Monitoring + alerts

Wire up alerts (Slack channel, email, or whatever ops uses) for:

- Any tenant transitioning to yellow → notify CS.
- Any tenant transitioning to red → notify platform team + CS.
- `131049` rate above N per hour for a tenant → notify CS.
- Auto-pause triggered → notify platform team.
- Spike in `consent_records.revoked_at` (mass opt-outs) → notify CS within 1h.
- WABA-level tier change (any direction) → notify platform team.

Build a simple admin dashboard tile showing: WABA tier, all tenants' current quality rating, sends in last 24h, opt-out rate, error rate.

---

## 12. Testing strategy

Unit / integration tests for:
- Cooldown enforcer rejects when consent missing, when throttled, when cap reached.
- Webhook handler correctly flips contact state on `131049` and `STOP` inbound.
- Auto-pause triggers when quality polled as red.
- Template review queue blocks unreviewed sends.
- Customer service window correctly opens/closes on inbound and after 24h.

End-to-end test (staging WABA):
- Send to a small test segment, simulate `131049` via Kapso sandbox.
- Confirm contact gets throttled, dashboard reflects state, next campaign skips them.

Load test:
- Cooldown enforcer must handle the largest tenant's full audience without becoming a send-time bottleneck. Cache consent + throttle state where possible.

---

## 13. Reference: error codes to handle

| Code | Meaning | Action |
|---|---|---|
| 131049 | Per-user marketing limit reached | Throttle contact for 24h |
| 131026 | Recipient cannot receive | Mark contact unreachable, skip future sends |
| 131047 | Template message expired (24h window passed) | Re-engage with new template |
| 131048 | Too many recipients | Reduce campaign batch size |
| 131045 | Template not approved | Block send, notify tenant |
| 131051 | Unsupported message type | Engineering bug, alert platform team |
| 131056 | Pair rate limit | Backoff and retry |
| 132xxx | Template-specific errors | Block, route to tenant |

Maintain this table in code as a constant + handler map. Update when Meta publishes new codes.

---

## 14. Hand-off

Once these components are designed and merged, hand off to CS team to use the operational dashboard and the auto-pause / quality view. The CS Onboarding Journey playbook (`cs-whatsapp-onboarding-journey.md`) is the operational counterpart to this engineering work.
