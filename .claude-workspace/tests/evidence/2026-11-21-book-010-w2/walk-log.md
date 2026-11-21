---
id: tests/evidence/2026-11-21-book-010-w2/walk-log
type: test
author: dev
created: 2026-11-21
status: active
supersedes: null
superseded_by: null
related: [specs/2026-11-20-book-010-guest-limits-and-stop, artifacts/2026-11-21-book-010-w2-impl, artifacts/2026-11-21-book-010-w2-handoff]
---
# BOOK-010 W2 local walk (2026-11-21, 11:25–11:30 HKT)

## Environment
- Tree `whatsapp-crm--book-010` at 4e4aeec3 (+ the month-badge wrap fix, re-shot as `05r-*`), `next dev -p 3030` (slot 3)
  with the Supabase vars pointed at the local stack and dummy Kapso / Gemini / FlowForge keys (env on the command line; `.env.local` untouched).
- **Local Supabase** (`supabase start`, CLI 2.109.1, same exclusions as the BOOK-009 recipe), reusing the
  `supabase_db_whatsapp-crm` volume from I-009 (001..091); **092 applied by psql** and recorded in
  `supabase_migrations.schema_migrations`; local-only grant re-run so `booking_stops` is reachable (as I-009). Not DEV or prod.
- Seed (fake, SQL): tenant "Walk Test Kitchen" (Mon–Fri 午市 12:00–14:00, 晚市 18:00–21:30, max party 8), bookings on
  Tue 24 Nov (19:00: 30 confirmed + 4 pending = 34; 18:00 6; 18:30 8; 19:30 2 pending; 12:00 10), Wed 25 Nov
  (60 lunch + 60 dinner), Thu 26 Nov (1 pending at 12:30), Fri 27 Nov (19:00: 28); two fresh chat tokens.
  Admin password reset through the local GoTrue admin API (value only in the session scratchpad).
- Browser: Playwright (playwright-core 1.58.2, Chromium 145, headless) from the scratchpad; the Chrome MCP servers did not connect
  this session. zh-HK, Asia/Hong_Kong. Staff 1440×900; diner 390×844 DPR 2 (plain viewport).
- Layout audit: `~/.claude/skills/ui-layout-audit/layout-audit.js` injected per checkpoint → `layout-audit.json`, `layout-audit-staff-1440-r2.json`.

## Steps (`walk-steps.json` has the raw results)
| # | Step | Result | Evidence |
|---|---|---|---|
| 1 | Login (real UI) | /dashboard | — |
| 2 | 設定 → 訂座: slot 70, meal 60, 儲存 | slot error "不能多於每餐最多的人數。"; DB limits: none (nothing saved) — AC-2 | 01-settings-limit-error-1440.jpeg |
| 3 | slot 30, 儲存, reload | fields 30 / 60; DB `{"perMeal": 60, "perSlot": 30}`; summary ends "每個時段最多 30 位，每餐最多 60 位。" — AC-1 | 02-settings-limits-saved-1440.jpeg, 02b-settings-summary-1440.jpeg |
| 4 | Nav 訂座 → Calendar → 24 Nov | Capacity block; 晚市 50 / 60, expanded (19:00 34 / 30 已滿) | 05r-staff-capacity-badges-1440.jpeg |
| 5 | Stop 午市 with the stops API stubbed to 500 (Playwright route) | switch back to on; "未能更新，請再試一次。" | 03-staff-stop-error-1440.jpeg |
| 6 | Stop 午市 (real API) | "walk-admin 已停止 · 11:26"; error gone; `booking_stops` row period 午市 2026-11-24 — AC-8 staff side | 05r-… |
| 7 | 26 Nov: stop 午市 (1 pending), then the whole day | note "仍有 1 個要求待回覆"; day line; month badge 26 = 已停止 — AC-9 | 04-staff-pending-note-1440.jpeg |
| 8 | Back to 24 Nov | badges: 25 已滿 (no slot fits 1), 26 已停止; after the fix also 24 已滿 (lunch stopped, dinner over 60) | 05r-month-grid-1440.jpeg |
| 9 | Confirm Chan Tai Man (19:00, 4) | prompt "確認後 19:00 會有 34 / 30 位客人。仍要確認？" → 仍要確認 → status pending → confirmed — AC-10 | 06-staff-over-limit-prompt-1440.jpeg |
| 10 | Staff console errors | only the expected 400 (step 2), 500 (step 5 stub), 409 (step 9 over_limit) | — |
| 11 | Diner `/b/<token>` signed out, party 4 | days: 24 open, 25 full, 26 full (stopped), 28 closed; 24 Nov slots: 午市 all 已滿 (stopped), 19:00 已滿, 18:00 / 19:30 open; hint "已滿的時段不夠 4 位入座…" — AC-12 | 07-diner-party4-full-390.jpeg |
| 12 | 27 Nov (19:00 at 28 / 30): party 2, pick 19:00, then party 4 | 19:00 open → picked → after party 4: data-state full, no longer pressed (choice cleared) — AC-12 re-evaluation | walk-steps.json |
| 13 | Second token: party 2, 24 Nov 18:30, name, terms; 22 guests inserted at 18:30 in the DB; submit | notice "這個時段剛剛滿了 / 18:30 已滿，請選擇其他時間…"; after refresh 18:30 data-state=full; no row stored for 24 Nov 18:30 by this diner (the `rows stored: 1` in walk-steps.json counts I-009's 21 Nov "Walk Diner" row, checked by SQL); token not consumed — AC-13 | 08-diner-full-recovery-390.jpeg |
| 14 | Diner console errors | none | — |

## Layout audit (AC-4)
| screen | breakpoint | blocking | warnings | notes |
|---|---|---|---|---|
| Settings → 訂座 | 1440 | 0 | 3 | page-level row-misaligned on the layout root and two settings-nav links: pre-existing, not touched |
| Bookings calendar + capacity (first pass) | 1440 | 0 | 10 | 8 column-indent on booking rows (pre-existing BOOK-004/008 row layout); **2 text-truncated: month-cell guest count squeezed by the new badge → fixed** (badge wraps), re-audited |
| Bookings calendar + capacity (r2, after fix) | 1440 | 0 | 9 | 8 column-indent + 1 column-misaligned, all on booking rows (pre-existing; the misaligned one is the row with the "message not delivered" badge after step 9) |
| Over-limit prompt open | 1440 | 0 | 10 | same as first pass (before the fix) |
| Diner page, party 4, 24 Nov | 390 | 0 | 0 | 1 info |

Detector (`impeccable detect --json` on the 7 new/changed UI files): `[]`, exit 0 (`detector.json`).

## Not walked
- en locale screens; staff phone (390) capacity block; tablet.
- PAP / AI channels (W1 scope; not UI).
- The full-page diner screenshot shows the fixed summary bar mid-page: a full-page capture artifact of the BOOK-009 fixed bar, not a layout defect (viewport audit 0 blocking).
