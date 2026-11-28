---
id: artifacts/evidence/2026-11-26-book-013-r3/walk-log
type: evidence
author: dev
created: 2026-11-26
status: active
related: [artifacts/2026-11-26-book-013-r3-handoff, specs/2026-11-26-book-013-staff-booking-crud]
---
# BOOK-013 r3 local walk (decision 8, AC-25)

## Environment
- Tree `whatsapp-crm--book-013` at the r3 code commit plus the phone chip fix (journal §8), `next dev -p 3060` (slot 6), once with `NEXT_PUBLIC_DEFAULT_LOCALE=zh-HK` and once with `en`.
- Local Supabase (`supabase start`, CLI 2.109.1, Postgres 17; realtime, studio, imgproxy, edge-runtime, logflare, vector, mailpit, postgres-meta, supavisor excluded). Migrations 001–095 applied by the CLI, **095 as revised in r3**.
- Local-only grant (never a migration): `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES` + sequences to the API roles (`seed-walk.sql`).
- Seed (`seed-walk.sh` + `seed-walk.sql`, reseeded before each run): **fake data only**. Tenant "Walk Test Kitchen", admin `walk-admin@example.test` created through local GoTrue (password from a scratch file, never logged), booking mode simple, slots 12:00–14:30 and 18:00–23:30, 20 guests per slot. Eight bookings today (lunch and dinner; Arrived, Late, Waiting, No-show, Needs reply; three "Chan" plus 陳生). Two on Sat 2026-11-28 (Hui Wing to edit and cancel, Tsang Group 16 guests at 19:00).
- External services: every key is a dummy; WhatsApp is faked by `fake-kapso.cjs` (a Node preload that answers api.kapso.ai and logs each request to `kapso-fake.jsonl`). No message leaves the machine.
- Driver: `walk.mjs` (headless Chromium over CDP, plain viewports 1440x900 DPR 1 and 390x844 DPR 2, the ui-layout-audit script on every screen). Console: `walk-console-<locale>-<width>.log`; steps: `walk-steps-<locale>-<width>.json`.

## Result
| run | checks | screenshots | console errors | confirmed blocking |
|---|---|---|---|---|
| zh-1440 | 34/34 | 15 | 0 | 0 (raw 0, see below) |
| zh-390 | 34/34 | 15 | 0 | 0 (raw 2, see below) |
| en-1440 | 34/34 | 15 | 0 | 0 (raw 1, see below) |
| en-390 | 34/34 | 15 | 0 | 0 (raw 2, see below) |

## Checks (each run)
| check | zh-1440 | zh-390 | en-1440 | en-390 |
|---|---|---|---|---|
| today: no Scan button, no code on any row (decision 8) | PASS | PASS | PASS | PASS |
| today: default sort is time ascending | PASS | PASS | PASS | PASS |
| today: rows by time | PASS | PASS | PASS | PASS |
| today: Lunch and Dinner headings while sorted by time | PASS | PASS | PASS | PASS |
| today: phone has the Sort select, desktop the column headers | PASS | PASS | PASS | PASS |
| sort name: URL ?view=today&sort=name&dir=asc | PASS | PASS | PASS | PASS |
| sort name: rows A–Z by the locale collation | PASS | PASS | PASS | PASS |
| sort name: no meal headings | PASS | PASS | PASS | PASS |
| sort name again: reversed, dir=desc in the URL | PASS | PASS | PASS | PASS |
| reload: sort kept (name desc) | PASS | PASS | PASS | PASS |
| search Chan: only the Chan bookings, still name Z–A | PASS | PASS | PASS | PASS |
| search Chan: URL sort unchanged | PASS | PASS | PASS | PASS |
| search Chan + time sort: Chan bookings by time | PASS | PASS | PASS | PASS |
| search 6555: Yeung Family only | PASS | PASS | PASS | PASS |
| search 陳: 陳生 only | PASS | PASS | PASS | PASS |
| sort guests: largest first (Yeung Family 8) | PASS | PASS | PASS | PASS |
| sort status: Late, Waiting, Needs reply, Arrived, No-show | PASS | PASS | PASS | PASS |
| arrived: row shows Arrived HH:MM | PASS | PASS | PASS | PASS |
| arrived: DB checked_in_at set, status confirmed | PASS | PASS | PASS | PASS |
| undo: DB checked_in_at cleared | PASS | PASS | PASS | PASS |
| form: existing member line shown for the typed phone | PASS | PASS | PASS | PASS |
| form: Notify diner ticked by default | PASS | PASS | PASS | PASS |
| rules: prompt lists the slot limit | PASS | PASS | PASS | PASS |
| rules: nothing written before Book anyway | PASS | PASS | PASS | PASS |
| create: confirmed, source staff, created_by set, linked to the existing member | PASS | PASS | PASS | PASS |
| create: staff_created event carries the overridden rules | PASS | PASS | PASS | PASS |
| create: no new member row | PASS | PASS | PASS | PASS |
| confirm send: develop's confirmed template, one BODY component with restaurant/date/time/party_size only (no header, no image, no code) | PASS | PASS | PASS | PASS |
| table: By staff badge on the row, no code | PASS | PASS | PASS | PASS |
| edit: party 4, status still confirmed | PASS | PASS | PASS | PASS |
| stale: 409 changed shows the banner, notes unchanged in DB | PASS | PASS | PASS | PASS |
| cancel: status cancelled, cancelled_by staff + user | PASS | PASS | PASS | PASS |
| mode off: no Bookings link in the sidebar | PASS | PASS | PASS | PASS |
| mode off: POST create answers 409 booking_off | PASS | PASS | PASS | PASS |

## Screens
| step | what |
|---|---|
| `01-today-time-<run>.jpeg` | Today, sorted by time (default) with Lunch / Dinner headings |
| `02-today-name-<run>.jpeg` | Sorted by name A–Z |
| `03-today-name-desc-<run>.jpeg` | Name again: reversed (Z–A) |
| `04-today-search-chan-<run>.jpeg` | Search "Chan" with the name sort kept |
| `05-today-guests-<run>.jpeg` | Sorted by guests, largest first |
| `06-today-arrived-<run>.jpeg` | Chan Wing Yan marked Arrived (Undo shown) |
| `07-form-new-<run>.jpeg` | New booking form (member line, slots with guests left, Notify on) |
| `08-rules-prompt-<run>.jpeg` | Rules prompt: slot over its guest limit, Book anyway |
| `09-created-toast-<run>.jpeg` | Toast after Book anyway |
| `10-row-menu-<run>.jpeg` | Row menu: Edit / Cancel booking |
| `11-form-edit-<run>.jpeg` | Edit form with the changed party marked |
| `12-form-stale-<run>.jpeg` | Stale edit: banner + Reload |
| `13-cancel-dialog-<run>.jpeg` | Cancel booking dialog with Notify diner |
| `14-cancelled-toast-<run>.jpeg` | Cancelled toast; row shows Cancelled by staff |
| `15-mode-off-<run>.jpeg` | Booking mode off: Bookings are off + Settings link |

## Layout audit findings, triaged
- `10-row-menu` (zh-390, en-1440, en-390; zh-1440 in its first run): `occluded`. The open ⋯ menu (Radix popover, fixed) covers the row under it. That is the menu doing its job; it closes on select or Escape. Same finding as round 1 (`../2026-11-26-book-013/walk-log.md`). Not a defect.
- First zh-390 run only: `page-scroll-locked` on `12-form-stale` and `13-cancel-dialog`. An open dialog / bottom sheet locks the page scroll by design and scrolls itself. It did not recur in the rerun. Not a defect.
- Warnings, not blocking: `column-indent` on the Table view phone cards (an existing component, round 1 had the same 8–10), `layout-shift` on first load in dev mode, `touch-target-small` on the Notify checkbox (20x20 inside a 44px label row; unchanged since round 1), `row-misaligned` on the page shell and the rules list. None is on the AC-25 controls.

## Found on the walk and fixed
- First zh-390 run: the phone card's state chip stretched across the card (journal `debugging_journals/2026-11-26-book-013-walk-fixes.md` §8). Fixed (chip beside the name, as round 1 and mockup frame 8); zh-390 was walked again and the en runs came after the fix. The screenshots here are all after the fix, except zh-1440, which the fix does not touch.

## Not walked
- Detector on the live routes: the pages need a login the detector cannot do. Static `impeccable detect` on the changed UI files returned `[]` (`impeccable-detect-src.json`).
- The real WhatsApp delivery (faked), the Meta template review of `changed` / `cancelled`.
