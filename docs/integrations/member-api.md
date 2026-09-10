# OhMyClient Member API (INT-001)

**Audience:** partner engineers integrating a POS / ordering system with OhMyClient.
**Transport:** server-to-server only. There is no browser flow, no OAuth, no session
cookie, no CORS support (the two partner routes send no `Access-Control-Allow-*`
header and have no `OPTIONS` handler — do not attempt to call them from a browser).
Every request is authenticated with a per-integration HMAC secret that only your
server and OhMyClient's server ever see.

Wire types referenced below are generated from `src/application/dtos/integration-member-api.ts`,
the single source of truth this document is written against.

---

## 1. Getting credentials

An OhMyClient restaurant owner creates an "Integration" in their dashboard
(**Integrations** area) and shares two values with you out of band (never over this
API):

- **`integrationId`** — a UUID identifying your connection to that one restaurant.
  Every request is scoped to this id; you cannot see or affect any other restaurant.
- **`webhook_secret`** — a 64-hex-character HMAC key, shown once at creation (or after
  a rotation). Store it like a password. If it's lost, ask the owner to rotate it in
  their dashboard — OhMyClient cannot recover a lost secret, only mint a new one.

If you also want OhMyClient to push events to you (new/updated members), you separately
mint your own secret and give it to the owner to paste into the **Outbound webhook**
card — see §6.

---

## 2. Authenticating a request (HMAC v2)

Every request to the two partner routes below carries three headers:

| Header | Format | Notes |
|---|---|---|
| `X-OMC-Timestamp` | unix seconds, digits only | must be within ±300s of the server's clock |
| `X-OMC-Nonce` | 16–64 chars, `[A-Za-z0-9_-]` | unique per request; a repeat within 10 minutes is treated as a retried, not a new, request |
| `X-OMC-Signature` | `v2=<64 lowercase hex chars>` | see below — exactly one `v2=` parameter, no others |

**Signature base string:**

```
POST base = "v2:member.create:" + integrationId + ":" + t + ":" + nonce + ":" + sha256hex(rawBody)
GET  base = "v2:member.job:"    + integrationId + ":" + t + ":" + nonce + ":" + jobId
```

`sha256hex(rawBody)` is the SHA-256 hex digest of the **exact bytes you send** on the
wire (compute it from the same string you serialize to the socket, not from a
re-serialized copy of the JSON object — whitespace/key-order differences change the
hash). The GET route has no body; its digest slot is the `jobId` from the URL itself.

```
signature = HMAC-SHA256(webhook_secret, base)   // hex-encoded, lowercase
```

Send it as `X-OMC-Signature: v2=<signature>`.

### Worked example (executed and verified byte-for-byte against this codebase's own `webhook-signature.ts` and independently reproduced in Python — see §9)

```
integrationId : 3fa7c2d0-3f2b-4a55-9b7e-7b6c9e6d1a10
webhook_secret: whsec_5f1c9e2a7b3d4e6f8091a2b3c4d5e6f7
t             : 1757548800
nonce         : kJ8H2pQmZx0Yb1Wn3RtV5cLd7gAsUf9E
body          : {"phone":"+85298765432","consent_level":"all","name":"Ada Lovelace","external_ref":"pos-order-88213"}

sha256hex(body) = 04fac61b0bb663b76df46a693b40d246390dbfdc4057a8a82b78f03fb472a0be

base = v2:member.create:3fa7c2d0-3f2b-4a55-9b7e-7b6c9e6d1a10:1757548800:kJ8H2pQmZx0Yb1Wn3RtV5cLd7gAsUf9E:04fac61b0bb663b76df46a693b40d246390dbfdc4057a8a82b78f03fb472a0be

X-OMC-Signature: v2=317e27bd1eb72e43d55838a6947ac948fca3455a58c536309faa881528f343d6
```

### Reference signer — Node.js

```js
const crypto = require('node:crypto')

function sha256hex(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex')
}

function signMemberCreate({ integrationId, webhookSecret, timestamp, nonce, rawBody }) {
  const base = `v2:member.create:${integrationId}:${timestamp}:${nonce}:${sha256hex(rawBody)}`
  return crypto.createHmac('sha256', webhookSecret).update(base, 'utf8').digest('hex')
}

function signMemberJobPoll({ integrationId, webhookSecret, timestamp, nonce, jobId }) {
  const base = `v2:member.job:${integrationId}:${timestamp}:${nonce}:${jobId}`
  return crypto.createHmac('sha256', webhookSecret).update(base, 'utf8').digest('hex')
}

// --- usage ---
const rawBody = JSON.stringify({
  phone: '+85298765432',
  consent_level: 'all',
  name: 'Ada Lovelace',
  external_ref: 'pos-order-88213',
})
const timestamp = Math.floor(Date.now() / 1000).toString()
const nonce = crypto.randomBytes(24).toString('base64url') // any 16-64 char [A-Za-z0-9_-] string
const signature = signMemberCreate({ integrationId, webhookSecret, timestamp, nonce, rawBody })

await fetch(`https://app.ohmyclient.io/api/integrations/${integrationId}/members`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-OMC-Timestamp': timestamp,
    'X-OMC-Nonce': nonce,
    'X-OMC-Signature': `v2=${signature}`,
  },
  body: rawBody, // send this EXACT string, not a re-serialized object
})
```

### Reference signer — Python

```python
import hashlib
import hmac
import secrets
import time

def sha256hex(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()

def sign_member_create(integration_id, webhook_secret, timestamp, nonce, raw_body):
    base = f"v2:member.create:{integration_id}:{timestamp}:{nonce}:{sha256hex(raw_body)}"
    return hmac.new(webhook_secret.encode("utf-8"), base.encode("utf-8"), hashlib.sha256).hexdigest()

def sign_member_job_poll(integration_id, webhook_secret, timestamp, nonce, job_id):
    base = f"v2:member.job:{integration_id}:{timestamp}:{nonce}:{job_id}"
    return hmac.new(webhook_secret.encode("utf-8"), base.encode("utf-8"), hashlib.sha256).hexdigest()

# --- usage ---
raw_body = '{"phone":"+85298765432","consent_level":"all","name":"Ada Lovelace","external_ref":"pos-order-88213"}'
timestamp = str(int(time.time()))
nonce = secrets.token_urlsafe(24)[:64]  # any 16-64 char [A-Za-z0-9_-] string
signature = sign_member_create(integration_id, webhook_secret, timestamp, nonce, raw_body)

headers = {
    "Content-Type": "application/json",
    "X-OMC-Timestamp": timestamp,
    "X-OMC-Nonce": nonce,
    "X-OMC-Signature": f"v2={signature}",
}
# requests.post(url, data=raw_body.encode("utf-8"), headers=headers)
```

**Important:** sign the raw bytes you transmit, not a value your HTTP library
re-serializes for you. If your framework re-encodes the body after you compute the
hash (e.g. re-stringifying a dict), the signature will not match what the server
receives.

---

## 3. Create a member — `POST /api/integrations/{integrationId}/members`

Body ≤ 16 KB, `Content-Type: application/json`.

| Field | Type | Required | Rules |
|---|---|---|---|
| `phone` | string | yes | any reasonably formatted phone number; normalized server-side to E.164 (default region HK if no country code is present). Rejected — never guessed — if ambiguous or invalid |
| `consent_level` | `"none" \| "utility" \| "all"` | yes | see §5 |
| `name` | string | no | ≤ 80 Unicode code points after control-character/whitespace cleanup (control chars and zero-width characters stripped, internal whitespace collapsed). Over the limit is **rejected**, never silently truncated |
| `external_ref` | string | no | ≤ 128 characters — your own order/customer id, echoed back in outbound events, never validated for uniqueness |
| `language` | `"en" \| "zh-HK"` | no | defaults to the restaurant's own default language if omitted |
| `send_welcome` | boolean | no | default `true`. `false` suppresses the welcome-template send for this member (does not affect member creation or consent recording) |
| `metadata` | object | no | ≤ 2 KB serialized, object nesting depth ≤ 3, JSON object only (no arrays/primitives at the top level). Stored verbatim, never interpreted |

**Response — `202 Accepted`:**

```json
{ "job_id": "mj_9f3a7c1b2e5d8091a4b6c7d0e2f13a58", "status": "queued", "poll_url": "/api/integrations/3fa7c2d0-.../members/jobs/mj_9f3a7c1b2e5d8091a4b6c7d0e2f13a58" }
```

`status` is `"queued"` or `"processing"` — this is an **acceptance** receipt, not the
result. Poll `poll_url` (§4) for the outcome. A `202` never means the member exists
yet; it means the request was accepted and queued.

---

## 4. Poll the result — `GET /api/integrations/{integrationId}/members/jobs/{jobId}`

Same HMAC scheme (§2, `GET` base string), no body.

```json
// still working
{ "status": "queued", "submitted_at": "2026-09-10T12:00:00.000Z", "attempts": 0 }
{ "status": "processing", "submitted_at": "2026-09-10T12:00:00.000Z", "attempts": 1 }

// done
{ "status": "succeeded", "member_id": "22222222-2222-2222-2222-222222222222", "outcome": "created" }
{ "status": "succeeded", "member_id": "22222222-2222-2222-2222-222222222222", "outcome": "existing" }

// failed (rare — validation failures are rejected synchronously at POST time, not here)
{ "status": "failed", "error": { "code": "tenant_inactive", "message": "..." } }
```

`outcome: "existing"` means a member with that phone number already existed for this
restaurant. Nothing else happened: no duplicate welcome message, no duplicate coupon,
and (important) **no reactivation** if that member had previously unsubscribed —
their subscribed/unsubscribed status and consent are untouched by a re-submission.

Job results are retained and pollable for **24 hours** after creation, then `410`.
The underlying record is kept ≥ 24 months for audit but is no longer partner-readable
after expiry.

Poll immediately after a `202` if you want low latency (member-create jobs typically
finish well under a second); otherwise a webhook (§6) will tell you when the member
is ready without polling at all.

---

## 5. `consent_level` — what you are asserting, and your responsibility

`consent_level` is **your attestation** that the end customer has agreed to receive
messages at this level, obtained through your own product (e.g. a checkbox at
checkout, a loyalty sign-up screen). OhMyClient does not independently verify this —
your system is the only one that ever showed the customer that notice.

| Value | Meaning |
|---|---|
| `"none"` | You have no consent from this customer beyond what's needed to fulfil their order. No marketing or utility WhatsApp messages triggered by this integration. |
| `"utility"` | Customer has agreed to operational messages (order updates, receipts) — not promotions. |
| `"all"` | Customer has agreed to both utility and marketing messages, including the welcome coupon (if the restaurant has one configured). |

**This is a real legal commitment, not a formality.** Hong Kong's Personal Data
(Privacy) Ordinance, Part VIA (direct marketing), requires that a marketing recipient
was actually given notice and consented. If your `consent_level` assertions do not
reflect a genuine notice-and-consent flow on your end, the restaurant — and you as
their data processor — carry that exposure, not OhMyClient.

The restaurant owner separately records, once per integration, **how** your product
collects this consent (a short description they type into their dashboard, plus an
acknowledgement). When that description is on file, records created via your API are
graded `strong`; without it, `weak`. The grade is visible internally and in outbound
`consent` payloads (§6) — it does not change whether messages send today, but it is
the record the restaurant would point to if a customer disputes having consented.

**Consent is one-way once revoked.** If a customer has ever texted STOP (or otherwise
unsubscribed) for a category, no `partner_api`-sourced request — from you or anyone —
can silently re-enable it. A repeat `POST` with a higher `consent_level` for that
phone/category is recorded as a **no-op** for that category, not an upgrade; the
customer must re-opt-in through a channel OhMyClient itself observes.

---

## 6. Outbound events — `member.created` / `member.updated`

If the restaurant has configured and PII-acknowledged an outbound webhook URL for
your integration, OhMyClient pushes JSON events to that URL as things happen. This is
optional from your side (you can poll instead, §4) — most partners want at least
`member.created` so they don't have to poll.

**Envelope** (`api_version` is pinned per payload shape; body ≤ 8 KB):

```json
{
  "id": "evt_7c1a9f3e2b5d4091a6c8d0e2f13a4b57",
  "type": "member.created",
  "occurred_at": "2026-09-10T12:01:00Z",
  "api_version": "2026-09-01",
  "restaurant_id": "11111111-1111-1111-1111-111111111111",
  "integration_id": "3fa7c2d0-3f2b-4a55-9b7e-7b6c9e6d1a10",
  "origin_integration_id": "3fa7c2d0-3f2b-4a55-9b7e-7b6c9e6d1a10",
  "data": {
    "member_id": "22222222-2222-2222-2222-222222222222",
    "phone_e164": "+85298765432",
    "name": "Ada Lovelace",
    "language": "en",
    "source": "partner_api",
    "external_ref": "pos-order-88213",
    "created_at": "2026-09-10T12:00:59Z",
    "consent": { "effective_level": "all", "utility": "opted_in", "marketing": "opted_in", "grade": "strong" }
  }
}
```

`member.updated` uses the identical envelope shape, plus `data.changed` (an array of
which fields changed: `name` | `language` | `status` | `consent` | `external_ref`) and
`data.status` (`"active" | "unsubscribed"`). A `ping` event (empty `data: {}`) is sent
when the owner clicks "Send test event" in their dashboard, and to nothing but the URL
they've saved.

**Every possible value for the enum-shaped fields inside `data`:**

| Field | Possible values |
|---|---|
| `data.source` | `"whatsapp"` (WhatsApp join) \| `"web"` (web QR join) \| `"csv_import"` \| `"partner_api"` — which channel originally created this member, not necessarily you |
| `data.consent.utility` / `data.consent.marketing` | `"opted_in"` \| `"pending"` \| `"opted_out"` \| `"none"` (no record at all for that category) |
| `data.consent.grade` | `"strong"` \| `"weak"` \| `"medium"` \| `"none"` \| `null` — how the platform grades the evidence behind the consent record (§5). This reflects the member's **current** consent record for that category, which may have been most recently written by a different channel than you (CSV import, a WhatsApp opt-in flow) — a request you made via this API can still surface `medium` or another grade your own assertions never produce, if something else touched that member's consent more recently |
| `data.consent.effective_level` | `"none"` \| `"utility"` \| `"all"` — the combined permission across both categories |

### `origin_integration_id` — echo suppression (read this before you build a sync loop)

`origin_integration_id` names the integration whose own API call caused the event, so
you can recognize your **own writes** coming back to you and skip re-processing them.

- On `member.created`: set to **your** `integrationId` when you were the one who
  created the member via this API; `null` if the member was created through another
  channel (WhatsApp join, web QR, CSV import) and you're just another subscriber.
- On `member.updated`: set to **your** `integrationId` when the change was caused by
  your own call into this API — specifically, a `POST` of yours that upgraded or
  inserted a consent record (`data.changed` includes `consent`), or that supplied an
  `external_ref` that changed an existing link (`data.changed` includes
  `external_ref`). It is `null` for every update made through another channel: the
  restaurant's dashboard, a WhatsApp opt-in/STOP, a CSV import, or another
  integration's own API call. A member's `name`/`language`/`status` fields (`data.changed`
  containing `name`, `language`, or `status`) are never changed by this API today, so
  those `member.updated` events are always `null`.
- **Coalescing note**: if two changes to the same member land within the same 5-second
  window (e.g. your consent upgrade and, coincidentally, the member texting STOP), they
  coalesce into one `member.updated` event with a unioned `data.changed`.
  `origin_integration_id` on that event is set **only when every write that landed in
  the window agrees** on the origin: two writes from the same integration keep that
  integration's id; a write of yours coalescing with an unattributed write (dashboard
  edit, WhatsApp opt-in/STOP, CSV import, another integration's own call) resolves to
  `null`, **even though one of the changes was yours**. Do not treat `null` here as
  "not mine" — treat `origin_integration_id` as reliable ONLY as a positive signal
  ("this specific id was involved, and nothing else was"), never as a negative one. A
  member's own STOP landing in the same window as your write is exactly the case this
  protects: it must never be swallowed by your own echo-suppression logic.

### Verifying an inbound webhook

```
X-OMC-Signature: t=<unix seconds>,v1=<64 hex chars>
```

```js
// Node.js
function verify(secret, header, rawBody, toleranceSec = 300) {
  const match = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(header)
  if (!match) return false
  const [, t, v1] = match
  if (Math.abs(Math.floor(Date.now() / 1000) - Number(t)) > toleranceSec) return false
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`, 'utf8').digest('hex')
  return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(v1, 'hex'))
}
```

```python
# Python
import re

def verify(secret: str, header: str, raw_body: str, tolerance_sec: int = 300) -> bool:
    m = re.match(r"^t=(\d+),v1=([0-9a-f]{64})$", header)
    if not m:
        return False
    t, v1 = m.group(1), m.group(2)
    if abs(int(time.time()) - int(t)) > tolerance_sec:
        return False
    expected = hmac.new(secret.encode("utf-8"), f"{t}.{raw_body}".encode("utf-8"), hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, v1)
```

Verified worked example (same body used in §2, executed and cross-checked in both
languages — see §9):

```
secret : partner_minted_secret_abc123XYZ
t      : 1757548860
X-OMC-Signature: t=1757548860,v1=28322631b85a0e071b57a926ca40e9b5b74571869215f39168583cf7d74e66c3
```

**Retry and breaker behaviour** (this is what happens on YOUR side, not something you
configure): a failed delivery is retried up to **5 times** with exponential backoff
(3s, 6s, 12s, 24s, 48s). A `429` with a `Retry-After` header is honoured. A `2xx`
response is the only thing that counts as success — any other status, a timeout, or a
connection error counts as a failure. After **10 consecutive failures**, the
restaurant's outbound delivery is automatically paused (no further attempts) until the
owner manually resumes it from their dashboard — so a sustained outage on your end
silently stops events rather than retrying forever; if you notice a gap, check with
the restaurant whether deliveries show as paused. Response bodies your endpoint
returns are read up to a small bound and are not exposed to you again — expect no
acknowledgement mechanism beyond the HTTP status code.

Each attempt signs with the **secret in effect at that moment** — if the restaurant
rotates your outbound secret mid-flight, in-flight attempts sent before the rotation
may fail verification on your side and will retry (and succeed) under the new secret.
Coordinate a secret rotation with your OhMyClient contact if you want a clean cutover.

---

## 7. Idempotency

A create request is idempotent for **24 hours** on the combination of
`(integrationId, phone, and every field you sent)` — resubmitting the exact same body
for the same phone returns the same `job_id` and does not create a second job, a
second welcome message, or a second coupon. Changing any field (e.g. raising
`consent_level` from `utility` to `all`) is a **different** idempotency key and starts
a new job, whose outcome will be `existing` (member already exists) with the consent
upgrade applied.

There is no idempotency key you supply yourself — it's derived entirely from the
request content, so retries with the exact same payload are always safe to fire
blindly (e.g. after a timeout where you don't know if the first attempt landed).

---

## 8. Error reference

Every error response follows one of these shapes. Field-level errors never echo the
value you sent — only which field and which code.

**Simple errors** (`{ "error": "<code>" }`):

| HTTP | `error` | Meaning |
|---|---|---|
| 401 | `unauthorized` | malformed/missing headers, unknown `integrationId`, expired timestamp (±300s), or bad signature — deliberately identical for all four so an attacker can't distinguish "wrong secret" from "no such integration" |
| 403 | `integration_inactive` | the integration exists but has been deactivated by the restaurant — signature already validated at this point |
| 413 | `payload_too_large` | body over 16 KB |
| 415 | `unsupported_media_type` | `Content-Type` is not `application/json` |
| 429 | `rate_limited` | your per-integration rate limit is exhausted — see `Retry-After` and `X-RateLimit-Remaining` headers; defaults are 60/min with a burst of 20, adjustable per-integration by the platform |
| 503 | `queue_depth_exceeded` | too many of *your* requests are already queued (default cap 500) — carries `Retry-After: 5` |
| 503 | `queue_unavailable` | the platform's queue is temporarily unreachable — no `Retry-After` is currently set on this one; back off and retry with jitter |
| 503 | `feature_disabled` | the platform has temporarily disabled inbound member creation (emergency kill switch) |
| 404 | `not_found` | (poll only) unknown `jobId`, or a `jobId` that belongs to a different integration — byte-identical either way, so a foreign job id cannot be distinguished from a nonexistent one |
| 410 | `result_expired` | (poll only) the job finished more than 24 hours ago |

Also charged before the signature check fully resolves: **10 consecutive
authentication failures per `(integrationId, your IP)` per 60 seconds** trips a
separate `429` — this protects the partner rate limit itself from being burned by an
attacker probing bad signatures, and does not count against your normal request budget.

**Validation errors** (`422`):

```json
{ "error": "validation", "fields": [{ "field": "phone", "code": "invalid_e164" }] }
```

| `code` | Meaning |
|---|---|
| `required` | field missing |
| `invalid_type` | wrong JSON type (e.g. a number where a string was expected) |
| `invalid_e164` | `phone` could not be normalized to a valid E.164 number |
| `invalid_enum` | `consent_level` or `language` is not one of the allowed values |
| `too_long` | `name` over 80 code points, `external_ref` over 128 chars, or `metadata` over 2 KB serialized |
| `too_deep` | `metadata` nesting exceeds 3 levels |
| `not_object` | the body itself isn't a JSON object, or `metadata` isn't a JSON object |

**Job failure** (`GET` poll, `status: "failed"`):

| `error.code` | Meaning |
|---|---|
| `validation` | should not occur — validation happens synchronously before `202` |
| `tenant_inactive` | the restaurant's account is not active |
| `integration_paused` | the integration was deactivated between your `POST` and the worker picking up the job |
| `internal` | an unexpected server-side error; the platform is alerted automatically, no action needed on your side beyond retrying later |

---

## 9. Verification of the examples in this document

Every signing example above was generated and round-trip-verified against this
codebase's actual `src/domain/services/webhook-signature.ts` (the same module the
live routes use), and the Python signer was independently re-run and confirmed to
produce byte-identical output for the same inputs. This is not a hypothetical example
— it is exactly what the production code computes for those inputs.
