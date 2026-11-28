---
id: tests/evidence/2026-11-20-book-009-i/walk-log
type: test
author: dev
created: 2026-11-20
status: active
supersedes: null
superseded_by: null
related: [specs/2026-11-20-book-009-booking-hours-and-form, plans/2026-11-20-book-009-010-plan, artifacts/2026-11-20-book-009-i-handoff]
---
# BOOK-009 I-009 end-to-end walk (2026-11-20, 23:20–23:30 HKT)

## Environment
- Tree `whatsapp-crm--book-009` at the merge commit (W1 + W2/W3 + W4), `next dev -p 3010` (slot 1).
- **Local Supabase** (`supabase start`, CLI 2.109.1, Postgres 17), migrations 001–091 applied by the CLI;
  realtime, studio, imgproxy, edge-runtime, logflare, vector, mailpit, postgres-meta and supavisor excluded.
  Real Postgres + PostgREST + GoTrue. Not DEV or prod Supabase.
- Local-only fix, never a migration: this CLI image's default privileges on `public` grant the API roles
  only `Dxtm` (hosted projects grant `arwdDxtm`), so every table answered 42501. Applied
  `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES` + sequences to anon/authenticated/service_role
  (the migrations contain no table-level REVOKE; RLS still applies, e.g. the user still reads 0 booking_tokens).
- Seed (fake): tenant "Walk Test Kitchen", admin user walk-admin@example.test, booking mode simple, agent booking on,
  two chat booking tokens. External keys (Kapso, Gemini, FlowForge) overridden with dummies; no Redis
  (rate limiters fail open: `[Booking]/[AgentBooking] rate limiter unavailable, allowing`).
- Browser: Chrome DevTools MCP, isolated contexts (admin; signed-out diner), zh-HK.

## Steps
| # | Step | Result | Mark | Evidence |
|---|---|---|---|---|
| 1 | Login → nav 設定 → 訂座及 AI 助理 | "未設定訂座時段" hint shown (AC-5); all blocks render | walked-on-local-supabase | — |
| 2 | Mon on, 午市 12:00–14:00 + 晚市 18:00–21:30, copy to all days, Sun off, terms zh/en, address, phone, 儲存 | "已儲存訂座設定"; summary "可訂座時間：星期一至星期六 午市 … 每枱最多 8 位。"; stored `booking_config.bookingHours` matches | walked-on-local-supabase | 01-settings-saved-1440-full.jpeg |
| 3 | 預覽訂座頁 (target _blank) | `/dashboard/booking-preview` with banner, saved config, Sundays 休息, terms in both languages, submit disabled | walked-on-local-supabase | 02-preview-1440-full.jpeg |
| 4 | Diner `/b/<token>` signed out, 390×844 | today 20 Nov (23:24) "沒有可選時間", Sun 22/29 休息; party 2, Sat 21, slots grouped 午市/晚市 every 30 min; 19:00; name; submit reads 請同意訂座須知 (disabled) until the tick | walked-on-local-supabase | 03-diner-filled-390-full.jpeg |
| 5 | Layout audit (layout-audit.js) on step 4 at 390 | 0 blocking / 0 warning / 1 info (touch-target-under-44) | walked-on-local-supabase | — |
| 6 | Tick terms → 提交訂座要求 | sent summary + "已同意訂座須知"; row `pending`, 21 Nov 19:00, 2 guests, `terms_accepted_at` set, `terms_text` = zh-HK + blank line + en (92 chars); token consumed | walked-on-local-supabase | 04-diner-sent-390-viewport.jpeg |
| 7 | Staff nav 訂座 → calendar day 21 → day panel; then Table view | row shows `booking-row-<id>-terms` "已同意訂座須知" in the day panel and in the table | walked-on-local-supabase | 05-staff-day-panel-terms-1440.jpeg |
| 8 | Times changed: 2nd token, page filled (3 guests, Sat 21 19:30, name, tick), then Saturday closed in the DB, then submit | server 400; notice "可選時段剛剛更新了 … 19:30 已不能預訂"; after refresh day 21 = closed; time cleared; party, name, tick kept; no row stored, token unconsumed | walked-on-local-supabase | 06-diner-times-changed-390-full.jpeg |
| 9 | PAP `GET /availability` 7 days, `days=32`, refused POSTs (closed_day, outside_hours, no accept_terms) | 200 with dates/times/terms (Sun closed, today none left); 400 too_large; 400 with `suggested_times`; 400 `accept_terms: terms_required` | walked-on-local-supabase (curl) | pap-probes.log |
| 10 | PAP `GET /openapi.json` | paths `/availability`, `/bookings`, `/bookings/{booking_id}` | walked-on-local-supabase (curl) | pap-openapi.log |

## Not walked
- AI reply agent (BOOKING RULES section, tool refusals with suggestedTimes, terms read-back/acceptance): no model
  call locally (dummy Gemini key, no inbound WhatsApp). Covered by tool-level tests only (W4).
- A successful PAP booking through the WhatsApp confirm code (needs Kapso inbound); `promote_agent_booking`
  returning the 091 columns is still schema-contract + fakes only.
- Shared 429 on `/availability` (no Redis locally; limiter fails open).
- en locale screens; staff phone (390) layout of the badge; tablet.
- DEV/prod Supabase: not used.

## Observations (not changed)
- Step 4: the first MCP click on the terms checkbox did not tick it; a second click did. Not reproduced, cause
  unknown (likely the click landing before the element settled); render tests cover the tick.
- Step 8: after the refusal the summary bar still shows the now-closed date (11月21日) as selected, with
  "請選擇時段". Matches W3's "clear the time only" rule (spec AC-9) but the day is no longer bookable.
