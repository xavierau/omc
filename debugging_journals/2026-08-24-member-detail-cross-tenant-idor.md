# Cross-tenant IDOR on /api/dashboard/members (GET detail, DELETE) — issue #111

**Date**: 2026-08-24
**Task**: #111 (filed under kanban SEC-004, cross-referenced to SEC-003)
**Severity**: High — cross-tenant read of member PII, receipts and coupons; existence oracle on delete

## Problem

`getMemberById(memberId)` in
`src/infrastructure/supabase/repositories/member-detail-repository.ts` ran all
three of its queries (members, receipts, coupons) filtered on the
request-supplied `memberId` alone:

```ts
supabase.from('members').select('*').eq('id', memberId).single()
supabase.from('receipts').select(...).eq('member_id', memberId)...
supabase.from('coupons').select(...).eq('member_id', memberId)...
```

Two call sites consumed it:

- `GET /api/dashboard/members?id=` (`handleMemberDetail`) never passed
  `restaurantId` to the lookup at all, even though it was already destructured
  in the caller for the list branch. Any authenticated tenant user who knew or
  guessed another tenant's member UUID got that member's name, phone, points,
  receipts and coupons back in a 200 response.
- `DELETE /api/dashboard/members/[id]` did pass the tenant, but only to a
  post-hoc comparison (`if (member.restaurant_id !== restaurantId) return
  403`) after fetching the row unscoped — the anti-pattern the repo already
  has a stated principle against. A 403 on a foreign id also confirms the id
  exists, which is itself an information leak (an existence oracle).

## Root cause

Same shape as SEC-001 (#100, `debugging_journals/2026-08-05-wa-template-cross-tenant-idor.md`):

1. `createServerSupabaseClient()` is the service-role key throughout the
   repository layer, so RLS is never a backstop — app-level scoping is the
   only guard.
2. The repository function was expressible without a tenant argument at all,
   and one of its two callers simply never supplied one.

## Solution

Authorize at query time, not after the fetch, so a foreign id is
indistinguishable from a missing one:

- Renamed `getMemberById(memberId)` →
  `getMemberDetailForRestaurant(memberId, restaurantId)` and added
  `.eq('restaurant_id', restaurantId)` to all three queries (members,
  receipts, coupons). The `restaurantId` parameter is required — the function
  can no longer be called without a tenant. No unscoped variant was kept:
  unlike SEC-001's `findById`, this repository has no legitimate caller whose
  id arrives from an already tenant-scoped row.
- `GET /api/dashboard/members?id=`: `handleMemberDetail` now threads the
  already-destructured `restaurantId` through to the scoped lookup.
- `DELETE /api/dashboard/members/[id]`: replaced the fetch-then-compare with
  the scoped lookup; the dead `if (member.restaurant_id !== restaurantId)
  return 403` block was deleted. A foreign id now falls into the existing 404
  path, byte-identical to a missing id — deliberate behaviour change,
  accepted (see plan `plans/2026-08-24-issue-111-member-detail-idor.md`, R1):
  no client branches on 403 vs 404, and a 403 is itself the existence leak
  being closed.
- Both routes still return `{ error: 'Member not found' }` at 404 with no
  other keys — nothing about a foreign member (name, phone, receipts,
  coupons, or even that the id *exists*) is observable to another tenant.

Tests: repository-level scoping assertions on all three queries (the actual
`.eq()` filters recorded, not just behaviour), cross-tenant/nonexistent/
malformed-UUID/happy-path coverage, and route-level tests pinning the
restaurantId being forwarded and the lookup never being reached before auth/
role checks pass. 32 new/changed tests across the three files (8 + 5 new + 3
changed), full existing suite green throughout.

## Live verification (I-1)

With a real tenant session (The Green Kitchen) against a throwaway member
belonging to a different tenant (OMC Kitchen):

- `GET /api/dashboard/members?id=<tenant-B member>` → `404`,
  `{"error":"Member not found"}` — no PII.
- `DELETE /api/dashboard/members/<tenant-B member>` → `404`,
  `{"error":"Member not found"}` — member confirmed still present in tenant
  B's data afterward.

Same-tenant flow re-verified live in the browser: member list → detail panel
(phone, points, status, receipts, coupons, stamp card all render) → delete →
`204` → row disappears from the list.

## Prevention

- Repo-wide principle restated (memory
  `principle_authorize_by_scoped_query`): scope the lookup by tenant at query
  time; never call `getTenantContext()` and then discard the result, and
  never compare ownership after an unscoped fetch. The check cannot be
  forgotten if the query cannot express the unscoped case.
- `...ForRestaurant` naming is now consistent across four repositories
  (`whatsapp-template-repository`, `campaign-repository`, `member-repository`,
  and now `member-detail-repository`) — at a call site, the scoped form is
  self-evidently scoped and the unscoped form is self-evidently not.

## Residual / follow-ups

- SEC-003 (repo-wide sweep for other dashboard routes assuming RLS the
  service-role client never enforces) remains open; #111 was one concrete
  instance closed ahead of that sweep.
- R3 from the plan, pre-existing and unrelated: `member-detail-panel.tsx`
  does not check `res.ok` before treating the response body as the member,
  so a 404 body renders as an empty panel instead of a not-found state. Not
  touched here (out of scope, Surgical Changes) — worth its own issue.
