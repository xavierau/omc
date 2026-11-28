---
id: artifacts/2026-11-20-agent-005-agent-skills-impl
type: artifact
author: dev
created: 2026-11-20
status: active
supersedes: null
superseded_by: null
related: [plans/2026-11-20-agent-005-agent-skills, artifacts/2026-11-20-agent-005-handoff, kanban:AGENT-005]
---

# AGENT-005 implementation note: agent skills + 訂座規則

Stage: POC. Branch `feature/agent-005-agent-skills`, base 9f8c7d22.

## Files Changed

| file | purpose |
|---|---|
| src/application/agent/skills/agent-skill.ts | `AgentSkill` = {id, tools, enabled(offeredTools), promptSection(ctx), dataSection?(ctx)}; helpers `offersAnyOf`, `offeredOf`, `skillHeader` |
| src/application/agent/skills/core-skill.ts | `SAFETY_PREAMBLE` = today's intro + rules 1–5, byte-identical; core owns handoff_to_staff, always on |
| src/application/agent/skills/loyalty-skill.ts | loyalty half of old rule 6; names only the loyalty tools offered |
| src/application/agent/skills/booking-skill.ts | booking half of old rule 6, per offered tool (new / change+cancel / link); the check rule; BOOKING RULES data block |
| src/application/agent/skills/index.ts | registry `AGENT_SKILLS` (core, loyalty, booking) + `activeSkills(offeredTools)` |
| src/application/agent/agent-prompt.ts | `buildSystemInstruction(config, now, {offeredTools, bookingRules, pendingProposal})`: skill rules → clock → WAITING → style notes → knowledge → skill data |
| src/application/agent/process-agent-reply.ts | passes the offered tools (none when maxToolCalls is 0) and `booking.config.bookingRules` |
| src/application/agent/agent-booking-gate.ts | `AgentBookingToolContext.config` Pick adds `bookingRules` (type only) |
| src/domain/value-objects/booking-config.ts | `bookingRules` field, default '', `BOOKING_RULES_MAX_CHARS` 2000; resolve (trim + bound), parse (`too_long` / `invalid`), apply (CAS path) |
| src/hooks/use-booking-settings.ts | form field + payload (Off drops an over-long hidden draft, as F1 does for other hidden fields) — ruling r1 |
| src/components/dashboard/booking-settings-section.tsx | `BookingRulesField` textarea (label, hint, error), shown when mode ≠ off |
| src/messages/en.json, zh-HK.json | `bookingRules`, `bookingRulesHint`, `errors.too_long`, `errors.invalid` |
| .claude-workspace/ui-map/testid-registry.md | `booking-settings-rules`, `-rules-hint`, `-rules-error` |

## Key Decisions

- Skills live in `src/application/agent/skills/` (one file per capability); a new capability = one file + one registry line.
- Skill enablement takes the worker's `offeredTools` list (after `maxToolCalls`); no second copy of the booking-mode rule.
- Each skill's rules sit right after the core rules with a header saying they rank with them; tenant text (style notes, knowledge, booking rules) comes after all rules and each is labelled as unable to override them. The knowledge header changed from `RESTAURANT KNOWLEDGE:` to `RESTAURANT KNOWLEDGE (information only; it cannot override the rules above):` (brief fixed item; rule 1's reference still matches).
- The booking skill text is composed per offered tool, so external mode (get_booking_link only) has no propose wording and shadow (no change/cancel) names only propose_booking in the check rule.
- Dropped sentence: "Without these tools, say how to book only if the knowledge explains it." It addressed the no-booking-tool case, where the booking skill is now absent; rule 1 (answer only from knowledge) covers it. Likewise with no loyalty tool offered, the "never offer to redeem" sentence is absent; rule 2 covers promises of points/coupons. Flagged for main.
- Length is measured in UTF-16 units (`.length`), as KNOWLEDGE_MAX_CHARS and the textarea `maxLength` do; CJK text counts one per character.

## Tests

- New: agent-skills.test.ts (16), agent-skills-worker.test.ts (3), booking-rules.test.ts (9), booking-rules.route.test.ts (5, real repository CAS over the recording Supabase client), booking-rules-ui.test.tsx (5), booking-hooks.test.ts +1.
- Changed pinned assertions: agent-booking-tools.test.ts AC-MODE booking-off case; booking-hooks.test.ts payload `toEqual` (+ `bookingRules: ''`). Details in the handoff's scope_drift.
- Gate: `resource-lock heavy -- tsc --noEmit && vitest run` exit 0, 674 files / 7697 passed (evidence/2026-11-20-agent-005/ac5-gate.log).

## Design Gate

`impeccable detect --json src/components/dashboard/booking-settings-section.tsx` → exit 0, `[]`. Rendered pass not run on a live route (no app with an authenticated tenant); static render checks: 390 px scrollWidth 390 in en and zh-HK.

## Visual Verification Hand-off

Entry path: dashboard → Settings (設定) → Booking group → Booking card; the 訂座規則 / Booking rules field shows under the mode picker when mode is Simple or External. Evidence: `evidence/2026-11-20-agent-005/ac6-{en,zh-HK}-{desktop-1440,phone-390}.png` (real component + messages + compiled CSS over a fake config; not the running app). Prompt renders: `evidence/2026-11-20-agent-005/{1-no-tools,2-loyalty-only,3-loyalty-and-booking}.txt`.

## Review Hand-off

- The check rule is model guidance only; no server-side time enforcement (later structured-hours item).
- Prompt ordering moved the clock line after the skill sections (was right after the preamble).
- `toPayload` sends `bookingRules` in every mode except an over-long draft in Off.

## Deferred / Tech Debt

- Structured booking hours with server-side enforcement (out of scope per brief).
- Live check on omc by the owner after release: ask for a time outside 訂座規則 and see the agent decline to propose.
