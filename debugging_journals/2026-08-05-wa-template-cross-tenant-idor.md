# Cross-tenant IDOR on /api/dashboard/wa-templates/[id] (SEC-001, issue #100)

**Date**: 2026-08-05
**Task**: SEC-001 · GitHub issue #100
**Severity**: High — cross-tenant read, modification and destruction of WhatsApp templates

## Problem

All three verbs on `src/app/api/dashboard/wa-templates/[id]/route.ts` authenticated the
caller but never authorized the resource:

```ts
await getTenantContext()          // result discarded
const { id } = await params
const result = await deleteWhatsAppTemplate(id)   // id only, no restaurantId
```

Any authenticated tenant that knew or guessed a template UUID could:

- `GET` another tenant's template,
- `PATCH` it — which deletes the victim's live template from **their** WABA and
  re-creates it from the attacker's payload,
- `DELETE` it, at Meta as well as locally.

Practical exposure was limited only because no UI issues these calls with an
arbitrary id. The endpoints were live and authenticated-only.

## Root cause

Two independent facts that are only dangerous together:

1. `createServerSupabaseClient()` is the **service-role** key, so RLS is not a
   backstop anywhere in the repository layer — app-level checks are the only guard.
2. `findById` / `softDelete` filter on `id` alone, and the route never passed the
   tenant down. `getTenantContext()` was called for its authentication side effect
   and its `restaurantId` was thrown away.

The sibling routes (`sync`, `resubmit`, `resolve-waba`) and `POST /wa-templates` all
destructure `restaurantId` and scope by it — this one route drifted.

## Solution

Authorize at query time rather than comparing ownership after the fact, so a foreign
id is simply *not found*:

- Added `findByIdForRestaurant(id, restaurantId)` to the template repository and
  scoped `softDelete` by `restaurantId` too (single caller, destructive path).
- `deleteWhatsAppTemplate(id, restaurantId)` and
  `updateWhatsAppTemplate(id, restaurantId, input)` now require the tenant and load
  through the scoped read. The tenant cannot be omitted by a future caller.
- Route threads `restaurantId` into all three verbs. A foreign id answers **404**,
  byte-identical to a missing one, so ids stay non-enumerable.
- `updateWhatsAppTemplate` throws a typed `TemplateNotFoundError` so the route can
  answer 404 instead of the previous generic 400.
- All three handlers now map `AuthError` to its own status; a 403 from the tenant
  guard previously surfaced as a 500 (the siblings already did this).

Tests: repository scoping (the filters actually applied), both use cases refusing a
foreign tenant without touching Meta, and route tests asserting 404 on all three
verbs for a foreign id.

## Prevention

- The standing principle holds and is now enforced in code: with a service-role
  client, **app-level scoping is the only guard** — see memory
  `principle_lazy_flow_authorization_parity`.
- `findById` (unscoped) now carries a comment stating it may only be used where the
  id came from an already tenant-scoped row (a campaign, a restaurant setting) —
  never from a request parameter.
- Prefer *scoped lookups* over post-hoc `if (row.restaurantId !== ctx.restaurantId)`
  comparisons: the check cannot be forgotten if the query cannot express the
  unscoped case.

## Residual / follow-ups

- `updateTemplate(id, changes)` in the repository is still unscoped. Ownership is
  proven by the scoped read immediately before it, and scoping it would touch eight
  call sites (webhook status handlers, sync, create) that legitimately have no
  request tenant. Left as-is deliberately.
- The broader question in #100 stands: which other dashboard routes assume RLS that
  is in fact never enforced? Worth a dedicated audit — not attempted here.
