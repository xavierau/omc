---
id: tests/2026-11-25-agent-006/ac3-README
type: test
author: dev
created: 2026-11-25
status: active
supersedes: null
superseded_by: null
related: [artifacts/2026-11-25-agent-006-campaign-context-impl]
---
# AGENT-006 AC-3 local walk

**What ran:** the real admit step and the real worker job. That is `processAgentReply` with the production deps from `agent-deps.ts`: local Supabase repositories, the real Gemini client on the `.env.local` key (model gemini-3.8-flash), and the real prompt and tools.

**What was replaced:** only the outbound edges. The queue hop runs inline, the WhatsApp send is captured to the log, and the booking proposal store is in memory. Booking is off for this tenant, so no Redis was touched. Driver: `tools/walk.ts`. Fixtures: `tools/seed.sql`. Cleanup: `tools/cleanup.sql`, already run.

All data is invented: tenant "A6 Test Izakaya", diner +85290000006, and three campaigns:
- **Omakase Night:** read 2 days ago. HK$880 per person, event 10 days ahead.
- **Sake Tasting:** delivered 15 days ago. HK$480, event 10 days ago.
- **Lobster Week:** failed 1 day ago. HK$999. It must not count.

| turn | diner | toolCalls | stored reply (`ac3-agent-messages.log`) |
|---|---|---|---|
| 1 | How much per person? | get_recent_campaigns | "The Omakase Night on 5 December 2026 is HK$880 per person (plus 10% service charge)…" |
| 2 | 清酒品酒會仲有冇位？我想訂2位 | get_recent_campaigns | "Sake Tasting 清酒品酒會已於 2026 年 11 月 15 日結束咗喇…12 月 5 日會有 Omakase Night…" (past event over, not offered) |
| 3 | 呢個Menu係咪直接訂5號？ | (none, answered from history) | "係呀…12 月 5 日舉辦。如果你想預訂…請問想預約幾多位呢？我可以同同事幫你跟進！" (no booking confirmed) |

The tool returned Omakase Night and Sake Tasting, newest first. Lobster Week (status failed) was excluded (`walk.tool.get_recent_campaigns` lines in `ac3-walk-{1,2}.log`).
