---
id: artifacts/2026-11-21-book-010-rl-handoff
type: handoff
contract: handoff-file-v1
author: dev
created: 2026-11-21
status: active
item: BOOK-010-RL
state: done
brief: inline (BOOK-010-RL brief-v1, main thread 2026-11-21)
base: 98b2f666
head: the commit that adds this file (on top of 3be8a10e); ls-remote checked after the final push
branch: fix/book-010-availability-rate-limit
pushed: true
pr: https://github.com/xavierau/omc/pull/224
stage: poc
suite_changed: false
gate: {result: n/a (POC: AC-1 file + whole-project tsc), at: 2026-11-21}
next: {owner: main, action: "review/merge the PR into develop; no migration, no env change"}
blockers: []
refs: [specs/2026-11-20-book-009-booking-hours-and-form, plans/2026-11-20-book-009-010-plan, kanban:BOOK-010]
---
ac:
  AC-1: {result: pass, evidence: "red first: the three new R2 tests failed over the 98b2f666 code (3 failed / 37 passed: 'expected 429 to be 200', the 11th availability call hit the shared 10/min bucket); green: the brief's command, 40/40 passed. Neighbouring poppy route tests (schedule-room, room-routes, routes) 63/63"}
  AC-2: {result: pass, evidence: "python3 ~/.claude/bin/resource-lock.py heavy -- npx tsc --noEmit → exit 0 (code commit 3be8a10e)"}
  AC-3: {result: pass, evidence: "https://github.com/xavierau/omc/pull/224 into develop; body states GET /availability 30/min per IP in its own bucket, POST /bookings unchanged at 10/min; ls-remote SHA == HEAD"}
decisions:
  - "Parameterised as a second helper next to the existing one: withinAgentAvailabilityIpLimit(limiter, ip) in create-agent-booking.ts, reusing the private withinWindow (same fail-open on a limiter outage), key book010:agent-availability:<ip>, limit AGENT_AVAILABILITY_LIMIT_PER_MINUTE = 30, window 60 s. Same limiter instance (getInboundRateLimiter), so no infrastructure change"
  - "Retry-After stays IP_RETRY_AFTER_SEC (60), the same 429 body and the same order (limit before the publicId gate)"
  - "The old test 'R2 same per-IP limiter as POST /bookings: the 11th call → 429' is replaced by three tests: the 30th call 200 / 31st 429 with Retry-After 60 (another IP still 200); 30 availability calls then 10 POSTs pass the IP limit (empty body → 400) and the 11th POST is 429; 10 POSTs then 30 availability calls 200 and the 31st 429"
  - "Empty-body POSTs are used to spend POST's IP bucket so the per-phone cap and the per-IP-per-restaurant window (5 per 30 min) are never reached"
failed: []
invariants:
  - "POST /bookings keeps key book003:agent:<ip> at 10/min, unchanged"
  - "both limits run before any database read and fail open on a limiter error"
unverified:
  - "real Redis behaviour of the new key (same incrWindow script as the existing key; not run against Redis here)"
  - "CI checks on the PR (looked in: not polled)"
review_focus:
  - "create-agent-booking.ts: withinAgentAvailabilityIpLimit and its key namespace"
  - "agent-booking-hours-routes.test.ts: the three replacement R2 tests"
scope_drift: []
next_step: "Review and merge the PR into develop; ships with the next release, no migration."
