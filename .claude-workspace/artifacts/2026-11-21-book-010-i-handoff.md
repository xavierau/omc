---
id: artifacts/2026-11-21-book-010-i-handoff
type: handoff
contract: handoff-file-v1
author: dev
created: 2026-11-21
status: active
item: BOOK-010-I
state: done
brief: inline (I-010 brief-v1, main thread 2026-11-21)
base: 22d11df8
head: the commit that adds this file (on top of 8b3d9290); ls-remote checked after the final push
branch: feature/book-010-guest-limits
pushed: true
pr: https://github.com/xavierau/omc/pull/223
stage: poc
suite_changed: false
gate: {result: pass, at: 2026-11-21T03:55Z}
next: {owner: main, action: "review PR #223 (stacked on #222); merge #222, retarget #223 to develop; 091 then 092 before any deploy"}
blockers: []
refs: [artifacts/2026-11-21-book-010-i-impl, tests/evidence/2026-11-21-book-010-i/walk-log, kanban:BOOK-010]
---
ac:
  AC-1: {result: pass, evidence: "merge commit 54c04267 (parents 22d11df8, a45f24d8); gate before commit: 0 unmerged paths, 0 '<<<<<<<'/'>>>>>>>' added; messages JSON valid, 1848/1848 keys in both locales. vitest-full.log: 725 files / 8338 passed, exit 0; tsc.log exit 0; eslint.log on 53 changed files exit 0 (tests/evidence/2026-11-21-book-010-i/)"}
  AC-2: {result: pass, evidence: "red first: ac2-red.log at 17df372c, 17 failed / 10 passed of 27; green: ac2-green.log, the brief's command plus the 3 route files, 7 files / 58 passed"}
  AC-3: {result: pass, evidence: "walk-log.md steps 1-14 + the three-way table (16 times × party 1 and 4: diner, /availability and staff AGREE); screenshots 01-10; consistency.json; pap-code-step.log (code step on the local stack: declined full / declined rules, one reply each)"}
  AC-4: {result: pass, evidence: "https://github.com/xavierau/omc/pull/223, base feature/book-009-booking-hours; ls-remote == HEAD after the final push (8b3d9290 verified before the records commit)"}
decisions:
  - "roomApplies = hours set AND scheduleEnabled: one gate, so page, PAP, AI, code step, over-limit confirm and staff capacity all follow the switch [W1 decision (a)]"
  - "Staff 'Booking hours are off' only when hours are stored with the switch off; no hours at all → no block, as today"
  - "A stopped slot reads 已滿 (the brief's rule; the W2 mockup showed none); its stopped line and switch are unchanged"
  - "Period 已滿 badge + amber bar (existing pending-foreground token) whenever the period is full; Meal full / 餐已滿 on its slots unless the slot itself is full or stopped [decide_yourself: copy]"
  - "Settings summary: new summarizeInWindow keeps limits for staff (F1 had switched it to summarizeForAgents, which drops them, breaking AC-1)"
  - "One chatBookingLink builder for F1's refusal link and W1's full reply (F1's https-checked appUrl)"
failed:
  - tried: "slot row and period header on one non-wrapping line"
    why: "at 390 the badges broke one character per line and the switches spilled past the card (6 content-spill, 1 text-truncated)"
    evidence: "layout-audit.json staff-capacity-390 first pass"
    replaced_by: "count + badge in a wrapping cell, switches in a shrink-0 wrapper (d4ffcfce); r2 at 390 has only the 6 pre-existing warnings"
  - tried: "tsx with top-level await for scripts/book-010/code-step-walk.ts"
    why: "tsx emits cjs here: 'Top-level await is currently not supported'"
    evidence: "pap-code-step.log note"
    replaced_by: "async main(); re-run with the same codes"
invariants:
  - "Migration 092 and W1's rule logic unchanged; no existing test changed, weakened or deleted"
  - "CLAUDE.md and supabase/.temp/cli-latest restored to HEAD and never committed (next dev re-adds its agent block to CLAUDE.md on every start)"
unverified:
  - "en locale screens not walked (copy unit-tested) — owner: main"
  - "WhatsApp webhook route not driven on the stack; code step exercised through verifyAgentBooking with real repositories — owner: main"
  - "Impeccable rendered pass not run (signed-in routes); source pass [] — owner: main"
  - "091/092 not on DEV or prod — owner: main/deploy"
review_focus:
  - "src/application/booking/verify-agent-booking.ts: recheck (rules) → promote with recheck.codes + promoteRoom (room)"
  - "src/app/api/dashboard/settings/booking/route.ts + agent-booking.ts summarizeInWindow (semantic merge conflict)"
  - "BOOK-009 F1 rules-refusal suggestions are rules-only, not room-aware: they can suggest a full time (seen in pap-code-step.log case B, harmless there)"
scope_drift: []
in_flight: []
next_step: "Main reviews PR #223. Local stack left running with the W2 + I-010 seed (`supabase stop` in the tree stops it); scratch containers book010-scratch-pg/-rest still up (scripts/book-010/scratch-db.sh down)."
---

Notes:
- The walk script and seed (`pw/walk-i010.mjs`, `book010i/seed-i010.sql`) are in the session scratchpad; the admin password and tokens live only there.
- CLAUDE.md's pre-W2 dirty diff (the next dev agent block) is backed up at `<scratchpad>/book010i/dirty-before-restore.patch`.
