# 2026-08-28 — Import preview hid rejected/duplicate rows until after commit (#139)

## Problem
The contact-import wizard's grade-preview step is the "look before you commit" gate, but it showed
nothing about rejected rows. A merchant re-uploading a list they had already imported saw a clean
preview, clicked Commit, and got a bare rejection count with no phones and no reasons.

Three distinct defects:
1. `previewContactsBatch` classified `invalid_phone` / `duplicate_phone_in_batch` rows into
   `rejected[]` but `step-grade-preview.tsx` only looped over `rows[]` and tested
   `rejectedByPhone.has(row.phoneE164)` — the two arrays are disjoint by construction, and
   `rejected[].phoneE164` carried the *raw* input while `rows[]` carried normalised E.164, so the
   red-highlight branch was doubly unreachable. Rejected rows silently vanished from the table.
2. Preview did zero database reads, so `phone_already_member` (unique index on
   `members(restaurant_id, phone)` when merge is off) and `duplicate_active`
   (`idx_consent_active_uniq`) could only surface at commit.
3. `step-confirm.tsx` rendered `result.rejected.length` and discarded the per-row
   `phoneE164 / reason / message` the API already returned.

## Root cause
The preview and commit paths were written as "twins" (same `classifyRows` shape) but the UI was
wired to the wrong array, and no test asserted that a rejected row is *visible*. The DB-dependent
reject reasons were never in the preview's contract at all.

## Solution
- Preview renders a rejections panel (count + `phone · reason`) above the table; the dead
  `rejectedByPhone` / `data-rejected` highlight was removed (AD-8) and replaced by a reachable
  `data-warned` row highlight driven by the new lookups.
- Preview now performs two read-only, tenant-scoped, chunked lookups of the accepted phones
  (`members.phone`, active marketing `consent_records.phone_e164`) and returns raw phone sets
  (`lookups`); the merge-checkbox verdicts are computed client-side by a pure
  `buildPreviewWarnings` whose precedence mirrors `resolveMemberId` (merge OFF: the member insert's
  23505 wins → `phone_already_member`; merge ON: the consent insert decides → `duplicate_active`).
  Zero network requests on toggle; lookups degrade OFF above 5,000 rows or on error.
- Confirm step lists rejected rows grouped by reason with copy-to-clipboard and CSV download.
- Preview remains zero-write, asserted by a whole-path test with a recording Supabase mock.

## Prevention
- Any UI that *filters* one list by another must have a test that puts a real entry in the second
  list and asserts it is rendered — "unreachable branch" bugs pass every existing test.
- Preview/commit twins must share their reject vocabulary end to end: the preview now returns the
  same `ImportRowRejectReason` values the commit path produces, and the precedence table lives in
  the plan (AM-4) with a test matrix (`preview-warning-helpers.test.ts`).
- Keep the merge-toggle recompute pure and client-side so it is unit-testable and free.

Related: GitHub #139, kanban WONB-017, plan `plans/2026-08-28-tag-001-issues-138-139`
(Amendments AM-4/AM-5), review `reviews/2026-08-28-tag-001-issues-138-139-analyzer`.
