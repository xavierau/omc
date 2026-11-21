---
id: tests/evidence/2026-11-21-book-010-i/walk-log
type: test
author: dev
created: 2026-11-21
status: active
supersedes: null
superseded_by: null
related: [specs/2026-11-20-book-010-guest-limits-and-stop, artifacts/2026-11-21-book-010-i-impl, artifacts/2026-11-21-book-010-i-handoff]
---
# BOOK-010 I-010 local walk (2026-11-21, 11:40–11:50 HKT)

## Environment
- Tree `whatsapp-crm--book-010` after the BOOK-009 merge (54c04267) and the I-010 commits; `next dev -p 3030` (slot 3) with the
  Supabase vars pointed at the local stack and dummy Kapso / Gemini keys on the command line (`.env.local` untouched).
- Local Supabase (`supabase_*_whatsapp-crm`, the I-009/W2 volume, migrations 001..092). Not DEV or prod.
- Seed (fake, SQL, `seed-i010.sql` in the session scratchpad): Mon **2026-11-30** as a special date with three periods
  (午市 12:00–14:00, 下午茶 15:00–16:00, 晚市 18:00–21:30); bookings 午市 12:00 27 + 12:30 27 + 13:00 26 (= 80),
  下午茶 15:00 2 pending, 晚市 19:00 30 + 19:30 27 pending (= 57); one chat token.
- Browser: Playwright (playwright-core, Chromium, headless), zh-HK, Asia/Hong_Kong. Staff 1440×900 (+ 390×844 DPR 2);
  diner 390×844 DPR 2. Raw step results: `walk-steps.json`; three-way data: `consistency.json`; audits: `layout-audit.json`.

## Steps
| # | Step | Result | Evidence |
|---|---|---|---|
| 1 | Login (real UI) | /dashboard | — |
| 2 | 設定 → 訂座: meal limit 80 (slot 30), 儲存 | stored `{"perMeal": 80, "perSlot": 30}` | 01-settings-limits-30-80-1440.jpeg |
| 3 | 訂座 → Calendar → 30 Nov | 午市 `data-state=full`, period 已滿 badge, bar `data-state=full` (amber); 12:00 "27 / 30 · 餐已滿", 13:30 "0 / 30 · 餐已滿" (no 已滿); 晚市 19:00 "30 / 30 · 已滿" | 02-staff-meal-full-1440.jpeg |
| 4 | Stop 下午茶 | "walk-admin 已停止 · 11:43", note "仍有 1 個要求待回覆"; `booking_stops` period 下午茶 2026-11-30 | 03-staff-tea-stopped-1440.jpeg, 03b-staff-day-1440.jpeg |
| 5 | Staff capacity API + rendered badges for 30 Nov | per-slot rows in the table below; no month badge (dinner still has room) | walk-steps.json |
| 6 | Staff phone 390 | first pass could not reach the day (week strip); re-run with next-week nav: **found and fixed** badges breaking one character per line and switches spilling (d4ffcfce); r2 0 blocking | 10-staff-capacity-390.jpeg, 10-staff-capacity-1440.jpeg |
| 7 | Diner `/b/<token>` (signed out): 30 Nov, party 1 then party 4 | day `open` for both; slot states in the table below | 05-diner-party1-390.jpeg, 06-diner-party4-390.jpeg |
| 8 | PAP `GET /availability` party_size 1 and 4; `POST /bookings` 19:00 party 4 | p1 times 18:00 18:30 19:30 20:00 20:30 21:00 21:30; p4 the same without 19:30; POST 400 `fields.time=full`, `suggested_times` 18:30, 18:00, 20:00 (30 Nov) | consistency.json |
| 9 | Three-way consistency (below) | **AGREE** on all 16 times, party 1 and party 4 | consistency.json |
| 10 | 設定 → 訂座: 使用訂座時段 off, 儲存 | limits block hidden; stored `scheduleEnabled false` (limits kept) | 07-settings-schedule-off-1440.jpeg |
| 11 | Staff 30 Nov, schedule off | "接受訂座 / 訂座時段已關閉，人數上限及停止訂座不適用。", 0 capacity switches, no month badge | 08-staff-hours-off-1440.jpeg |
| 12 | Schedule off: diner page; PAP availability p4; POST 19:00 p4 | BOOK-001 form (no `data-variant`); `{open: true, times: null}`; POST **202** (no full) | 09-diner-schedule-off-390.jpeg |
| 13 | Switch back on, 儲存 | limits 30 / 80 back; 下午茶 stop shown again; POST 19:00 p4 → 400 `time: full` | walk-steps.json |
| 14 | Console errors | staff none, diner none | — |

## Three-way consistency, 2026-11-30 (step 9)
"staff →" = what the staff numbers allow (not stopped, slot guests + party ≤ 30, meal guests + party ≤ 80). Diner = slot `data-state`.

| time | period | staff (slot · meal · badge) | staff → p1 | diner p1 | /availability p1 | staff → p4 | diner p4 | /availability p4 |
|---|---|---|---|---|---|---|---|---|
| 12:00 | 午市 | 27/30 · meal 80/80 · Meal full | — | full | — | — | full | — |
| 12:30 | 午市 | 27/30 · meal 80/80 · Meal full | — | full | — | — | full | — |
| 13:00 | 午市 | 26/30 · meal 80/80 · Meal full | — | full | — | — | full | — |
| 13:30 | 午市 | 0/30 · meal 80/80 · Meal full | — | full | — | — | full | — |
| 14:00 | 午市 | 0/30 · meal 80/80 · Meal full | — | full | — | — | full | — |
| 15:00 | 下午茶 | 2/30 · meal 2/80 · period stopped | — | full | — | — | full | — |
| 15:30 | 下午茶 | 0/30 · meal 2/80 · period stopped | — | full | — | — | full | — |
| 16:00 | 下午茶 | 0/30 · meal 2/80 · period stopped | — | full | — | — | full | — |
| 18:00 | 晚市 | 0/30 · meal 57/80 | open | open | open | open | open | open |
| 18:30 | 晚市 | 0/30 · meal 57/80 | open | open | open | open | open | open |
| 19:00 | 晚市 | 30/30 · meal 57/80 · Full | — | full | — | — | full | — |
| 19:30 | 晚市 | 27/30 · meal 57/80 | open | open | open | — | full | — |
| 20:00 | 晚市 | 0/30 · meal 57/80 | open | open | open | open | open | open |
| 20:30 | 晚市 | 0/30 · meal 57/80 | open | open | open | open | open | open |
| 21:00 | 晚市 | 0/30 · meal 57/80 | open | open | open | open | open | open |
| 21:30 | 晚市 | 0/30 · meal 57/80 | open | open | open | open | open | open |

## PAP code step on the local stack (`pap-code-step.log`)
`scripts/book-010/code-step-walk.ts` runs `verifyAgentBooking` with the real repositories against local PostgREST
(`promote_agent_booking_with_room`, F1's `findPromotable` / `declineUnverified`); only the WhatsApp senders are recorders.
- Case A (rules pass, slot filled after POST): row `declined full`, `decided_by null`; one reply, the full reply with 3 times that fit and the link.
- Case B (date made closed after POST, slot also filled): row `declined rules`; one reply, the BOOK-009 "can no longer be booked" text; no full reply.
- The webhook route itself (Kapso signature → `verifyAgentBooking`) was not driven; route-level tests cover it.

## Layout audit
| screen | breakpoint | blocking | warnings | notes |
|---|---|---|---|---|
| Staff calendar + capacity, 30 Nov | 1440 | 0 | 6 | 6 column-indent on booking rows (pre-existing BOOK-004/008 row layout) |
| Staff capacity r2 (after the phone fix) | 1440 | 0 | 6 | same 6 |
| Staff capacity first pass | 390 | 0 | 13 | 6 pre-existing + 6 content-spill (slot switches) + 1 text-truncated (午市 guests) → **fixed** |
| Staff capacity r2 | 390 | 0 | 6 | the 6 pre-existing only |
| Staff, schedule off | 1440 | 0 | 6 | same 6 |
| Diner, party 4 | 390 | 0 | 0 | 1 info |

Detector (`impeccable detect --json` on capacity-block.tsx and capacity-period.tsx): `[]`, exit 0 (`detect-source.json`).
Rendered detector pass not run: the routes need a signed-in session the detector cannot hold.

## Not walked
- en locale screens (copy checked by unit test only).
- AI agent channel (no model call locally): roomApplies unit tests and the existing agent tool tests cover it.
- The diner full-page shots show the fixed summary bar mid-page: a full-page capture artifact, not a layout defect (viewport audit 0 blocking).
