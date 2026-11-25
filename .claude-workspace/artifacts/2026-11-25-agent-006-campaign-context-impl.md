---
id: artifacts/2026-11-25-agent-006-campaign-context-impl
type: artifact
author: dev
created: 2026-11-25
status: active
supersedes: null
superseded_by: null
related: [artifacts/2026-11-20-agent-005-agent-skills-impl, tests/2026-11-25-agent-006/ac3-README]
---
# AGENT-006: the reply agent reads the campaigns the diner received (implementation note)

Stage: **POC**. The repo does not import `stages/mature.md`, and no `WT_STAGE` is set. Base: `origin/develop` c37fdba0. Branch: `feature/agent-006-campaign-context`.

## Files Changed

| file | purpose |
|---|---|
| `src/domain/value-objects/agent-config.ts` | `get_recent_campaigns` added to `AGENT_TOOL_NAMES`, after `handoff_to_staff`. It joins `DEFAULT_ENABLED_TOOLS`. A stored `enabledTools` array is kept as is. |
| `src/domain/ports/agent-reply.ts` | Adds `AgentCampaignSend {campaignName, sentAt, components}`, `AgentRecentCampaignsQuery {sinceIso, limit}` and `AgentToolData.listRecentCampaigns(key, query)`. |
| `src/infrastructure/supabase/repositories/agent-campaign-repository.ts` (new) | `listAgentRecentCampaigns`: 2 to 4 queries, each scoped by restaurant (see Key Decisions). |
| `src/infrastructure/supabase/repositories/agent-tool-repository.ts` | Wires `listRecentCampaigns` into `agentToolData`. |
| `src/application/agent/agent-campaign-tool.ts` (new) | Applies the 30-day window, keeps at most 3, and builds `templateText`: the header text, the body, then `Button "<label>": <url or phone>`. Placeholders are left as is, and the text is cut at 1500 characters. |
| `src/application/agent/agent-tools.ts` | Adds the declaration (no parameters) and the `runTool` case, which uses `ctx.key` and `ctx.now()` only. |
| `src/application/agent/skills/campaigns-skill.ts` (new), `skills/index.ts`, `skills/agent-skill.ts` | Adds the `campaigns` skill. `AGENT_SKILLS` is now core, loyalty, campaigns, booking. |
| `src/messages/{en,zh-HK}.json` | Adds `tool.get_recent_campaigns` and `toolHint.get_recent_campaigns`. The checkbox renders from `AGENT_TOOL_NAMES`, so it needed no component change. |
| tests | New: `agent-campaigns-skill.test.ts` and `agent-campaign-repository.test.ts`. Extended: `agent-tools.test.ts`, `agent-config.test.ts`, `agent-skills.test.ts`, `agent-schema-contract.test.ts` and the fake tool data in `agent-fakes.ts`. Updated for the fourth default tool: `agent-booking-tools.test.ts`, `agent-booking-hours.test.ts` and `agent-booking-schedule-switch.test.ts`. |

## Key Decisions

**Window and order use `queued_at`, not `sent_at`.**
- `attachKapsoMessageId` guards on `status = 'queued'`. When a status webhook moves the row to delivered first, `sent_at` stays null.
- `queued_at` is NOT NULL, and `idx_wa_messages_member_queued (member_id, queued_at) WHERE member_id IS NOT NULL AND direction = 'outbound'` (migration 080) serves the query because it filters on `direction = 'outbound'`.
- The reported `sentAt` is `sent_at ?? queued_at`.
- So no migration or index was needed.

**One row per campaign.**
- A campaign leaves one or two rows per diner: the template body, plus the coupon QR image in eager mode.
- The newest accepted row gives `sentAt`.
- The template is the newest non-null `template_id` among that campaign's rows, else `campaigns.whatsapp_template_id`.
- The scan reads at most 50 rows, which covers any 3 campaigns.

**Separate scoped queries, not PostgREST embeds.**
- The order is: members (restaurant_id + phone), then whatsapp_messages (restaurant_id + member_id + outbound + campaign_id not null + status in sent/delivered/read + window), then campaigns (restaurant_id + id in), then whatsapp_templates (restaurant_id + id in).
- Each is scoped by the job restaurant. The campaign and template queries are skipped when there is nothing to fetch.
- No member id, phone or campaign id is returned to the model.

**The member lookup is a 6-line copy in the campaign repository.** Extracting it from `agent-tool-repository.ts` created an import cycle, because the tool repository wires `agentToolData` and the campaign repository would import from it. The copy uses the same scoped query.

**Components are parsed once where they enter.** `toComponents` keeps array items that are objects with a string `type`. Anything else is dropped (`[]`). The button phone accepts `phoneNumber` or `phone_number`.

**FOOTER and QUICK_REPLY are left out of `templateText`.** The brief names the header, the body and URL/phone buttons.

**Text-mode campaigns** (no template) give `templateText: ''`. The model then sees only the campaign name. `content_preview` was not used, as the brief directed.

**Skill wording.**
- The rules name the bare questions in the brief.
- The "past event" rule points at the `CURRENT DATE AND TIME IN HONG KONG` line.
- The booking rule says "follow the booking rules in this instruction". It deliberately does not reuse the `TABLE BOOKINGS` header string, because the AGENT-005 tests locate that section by its header.

**Fixture tests kept frozen.** The BOOK-009 hours-null prompt fixture tests (`agent-booking-hours`, `agent-booking-schedule-switch`) now offer every tool except `get_recent_campaigns`. The fixture records the pre-BOOK-009 booking prompt and was not regenerated.

## Tests

- **AC-1:** RED first, 10 failing in 6 files (`tests/2026-11-25-agent-006/ac1-red.log`). Then GREEN, 92/92 in the same 6 files (`ac1-green.log`).
- **AC-2:** `tsc` exit 0. Full vitest: 728 files passed, 17 skipped; 8400 tests passed (`ac2-gate.log`). No flaky re-run.
- **AC-3:** real worker job, local stack, Gemini dev key (`tests/2026-11-25-agent-006/ac3-README.md`).
- **AC-4:** the running app, zh-HK, 1280 and 390 (`ac4-checks.log`, two screenshots).
- **Suite changes after RED:** `agent-skills.test.ts` `BOOKING_ENABLED` now excludes the new read-only tool, and the 3 booking test files were updated as listed. Each change follows from the brief's fixed rules (new default tool; skill order).

## Deferred / Tech Debt

- Template parameters are not rendered. The model is told not to quote `{{…}}`.
- `src/test-utils/recording-supabase.ts` does not chain `.not()`, and it is outside `files_allowed`. The repository test adds a local shim.
- Turn 3 of the walk ("呢個Menu係咪直接訂5號？", booking off) asked for a party size and offered a staff follow-up without calling a tool. It confirmed no booking. This is how the booking-off prompt behaves; it is not this slice.

## Review Hand-off

- **Scoping:** check the four queries in `agent-campaign-repository.ts`. Identity comes only from `ctx.key`, and the tool test asserts that model args are ignored.
- **Prompt injection:** campaign text is restaurant-written. The skill marks it as data. Tenants write their own templates, so the trust level matches the knowledge sheet.
- **Default-on:** a new tenant, or a stored config without `enabledTools`, gets the tool. Stored arrays are not migrated: the owner ticks the box.
