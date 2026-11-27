---
id: plans/2026-11-26-book-013-staff-booking-crud
type: plan
author: main
created: 2026-11-26
status: active
supersedes: null
superseded_by: null
related: [specs/2026-11-26-book-013-staff-booking-crud, threats/2026-11-26-book-013-staff-booking-crud, kanban:BOOK-013]
---

# Plan (POC): staff booking CRUD + check-in (BOOK-013), one PR into develop

Design reference: `.claude-workspace/design/2026-11-26-book-013-staff-bookings/mockup.html` (frames 1–10; Open Design project `omc-book-013-staff-bookings`).

1. Migration 095 (scratch-DB validated): source `staff`; `created_by`, `updated_by`; `cancelled_by` + `'staff'` and `cancelled_by_user`; `notify_diner bool default true` (reminder cron skips false); `checkin_code` (unique per restaurant where not null), `checked_in_at/by` (check: not with `no_show`); `last_staff_message_at`; QR storage bucket with no anon list (R8, R10, R11, R14, R16). AC-1–AC-2, AC-12, AC-17, AC-22.
2. Domain: staff booking input parser (allow-list, E.164, limits; R4, R7); rule check that reports every broken rule without refusing, reusing booking-hours / booking-room (AC-3, AC-8 with self-exclusion); check-in code generator (BOOK-003 alphabet, CSPRNG; R8) and strict scan parser `^(BK:)?code$` (R15); arrived/no-show exclusivity (R14).
3. API (one shared `STAFF_ROLES`, tenant-scoped queries, conditional writes on status + `updated_at`, mode-off 409, events rows; R1–R6, R9, R13): `POST /api/dashboard/bookings` (create, `override` flag → 409 `rules` with the broken list when false), `PATCH /bookings/[id]` (edit), `POST /bookings/[id]/cancel`, `POST|DELETE /bookings/[id]/check-in`, `GET /bookings/today` (capped, R12), `GET /bookings/by-code/[code]`. Member link via the BOOK-008 rule (R17). AC-1–AC-16, AC-20–AC-24.
4. Confirm path: every transition to `confirmed` (staff Confirm, change confirm, staff create) mints the code in the same write; the confirmation send renders the QR PNG (`qrcode`, payload `BK:<code>`), uploads it under a random path, sends the image-header template or, in the 24h window, an image message with caption; cancel/decline deletes the file; retention purge nulls the code and deletes the file (R10, R16). AC-17–AC-19.
5. Templates: kinds `changed`, `cancelled` (zh_hk + en) and a new image-header `confirmed` body with `{{code}}`; provision for new tenants; existing provisioned tenants get them submitted as BOOK-002 candidates (old approved confirmed keeps sending until approved); submit-time example image via the PR #68 Kapso handle path; send rules: edit message only when date/time/party changed, ≤1 staff message per booking per 5 min (R11). AC-6, AC-12, AC-14, AC-18.
6. UI (BOOK-004 components, mockup frames 1–8, 10): New booking button + day-panel Add; form dialog / phone bottom sheet with member line, slots with guests left, Other time, Notify checkbox; rules prompt; ⋯ menu Edit / Cancel; stale banner; cancel dialog; "By staff · name" badge; Today view (default on phone) with search (name, phone digits, code), counters, Waiting / Late / Arrived / No-show, Arrived + Undo also in day panel and table; Scan via the existing `html5-qrcode` scanner; check-in code on rows; mode-off: hide nav entry + "Bookings are off" page.
7. Member panel stats count arrived (AC-23).

Wiring: `bookingsNavItem` gated on mode (sidebar test), `?view=today` in bookings-view-state, i18n keys in `src/messages/en.json` + `zh-HK.json`, test ids from the spec + `.claude-workspace/ui-map/testid-registry.md`, template kinds in `TEMPLATE_KINDS` and the settings template list, kanban BOOK-013 entry (`workspace_artifacts` → spec, threat, plan) in the branch.
Verify: route/domain tests per R-id, scratch-DB migration check, local app walk (`supabase start`) with screenshots of create → rules prompt → edit → cancel → confirm with QR message payload → Today search/scan → Arrived, at 1440 and 390, en + zh-HK. Live Meta approval of the new templates is checked after release, not in this PR.

Revision 2026-11-26 (spec decision 8 + AC-25): items 4 and the QR/code parts of 1, 2, 3, 5, 6 are withdrawn (no check-in code, QR, bucket, by-code route, scan UI, confirmed-template change). Added: Today list sort (Time default / Name / Guests / Status, reversible, in the URL), mockup frames 7–8 revised. Review fixes R1–R3, R7, R8, R10 landed in 2f6e3b82.

Risks: image-header `confirmed` may be rejected by Meta more often (spec Dependencies & Risks); existing-tenant template backfill mechanism to be found by the dev (where BOOK-002 resubmits), reported in the handoff if none exists.
