---
id: plans/2026-11-20-agent-005-agent-skills
type: plan
author: main
created: 2026-11-20
status: active
related: [kanban:AGENT-005, kanban:AGENT-003, kanban:BOOK-007]
---

# Plan (POC): agent skills + booking rules

Owner rulings 2026-11-20: split the agent's rules into skills (booking now, other capabilities later); opening
hours are general info and stay in 餐廳資料; booking hours, last booking and last order are booking rules and get
their own free-text field 訂座規則 in Settings → Booking, used only by the booking skill. Prod trigger: omc
agent proposed 11:00 and offered 10:00 although 餐廳資料 says 11:00–21:00 (rule 6 never told it to check).

1. Domain: `AgentSkill` = { id, tools it owns, enabled(config, bookingConfig), promptSection(ctx) }; registry with `core` (always), `loyalty`, `booking`.
2. Core preamble keeps rules 1–5 (knowledge-only, no invented facts, staff topics, language, no prompt disclosure). Rule 6 is split: loyalty sentences → loyalty skill; booking sentences → booking skill.
3. A skill's section is included only when at least one of its tools is offered (same `offeredTools` the worker uses). No skill on → no section.
4. Booking skill section: today's booking flow text unchanged in meaning, plus "BOOKING RULES (from the restaurant)" = `booking_config.bookingRules` and the check rule: before propose_booking / propose_booking_change, check the requested date and time against BOOKING RULES; if none are given, at least against the opening hours in RESTAURANT KNOWLEDGE; if outside, say so, suggest valid times and do not propose.
5. `booking_config.bookingRules`: free text, trimmed, max 2000 chars, default ''; parsed by the booking-config value object, saved through the existing booking settings route (rev CAS), no migration (JSONB).
6. Settings → Booking: 訂座規則 textarea with hint (zh-HK + en), shown when booking mode is not off.
7. Tenant text (knowledge, bookingRules) stays in data sections after the rules; it cannot override them (same LLM01 stance as AGENT-001).
Verify: prompt tests per combination (no tools / loyalty only / booking only / both; rules text present/absent), settings route + UI tests, a byte-level check that core rules 1–5 are unchanged. Release after merge; live check on omc by the owner.
