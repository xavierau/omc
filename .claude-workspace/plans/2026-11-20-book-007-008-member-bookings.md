---
id: plans/2026-11-20-book-007-008-member-bookings
type: plan
author: main
created: 2026-11-20
status: active
related: [threats/2026-11-20-book-007-008-member-bookings, kanban:BOOK-006, kanban:BOOK-007, kanban:BOOK-008]
---

# Plan (POC): no-show status + member ↔ booking linking

Order: BOOK-006 (in flight, same files) → BOOK-007 → BOOK-008 (its stats count `no_show`). One `dev` each, each a PR into develop.

1. BOOK-007 migration 087: status CHECK + `no_show`; `no_show_marked_by`/`_at`; decision constraint keeps `decided_at` for no_show (R5, R6).
2. BOOK-007 domain + API: `POST /api/dashboard/bookings/[id]/no-show` and `DELETE` (undo), tenant-scoped conditional UPDATE, past-only, no diner message (R5).
3. BOOK-007 UI + wiring: "未出席 / No-show" action on past confirmed rows (table, cards, day panel), undo, badge/filter chip, covers/reminders/purge allow-lists (R9).
4. BOOK-008 linking: phone auto-link at create and at poppy verification (existing member only), one-off backfill in migration 088 (R1, R7).
5. BOOK-008 API: `PATCH /api/dashboard/bookings/[id]/member` link/unlink, scoped by tenant, events audit row (R2, R4).
6. BOOK-008 member panel: Bookings section (newest 50) + stats (total, confirmed, cancelled, declined, no-show, last/next date) from the member detail route (R2, R8).
7. BOOK-008 booking views: diner name opens the member panel; "Link member" / "Change" / "Unlink" with the existing members lookup (R3 unchanged messaging).
Wiring: i18n keys in every locale of `bookings`/`members`, test ids + registry, kanban entries. Verify: route/component tests, scratch-DB migration check, screenshots from fakes; live check on omc after release.
