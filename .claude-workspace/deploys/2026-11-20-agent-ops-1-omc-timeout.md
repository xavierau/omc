---
id: deploys/2026-11-20-agent-ops-1-omc-timeout
type: deploy
author: dev
created: 2026-11-20
status: executed
supersedes: null
superseded_by: null
related: [kanban:AGENT-OPS-1, deploys/2026-11-19-agent-003-release-runbook]
---

# Ops: omc agent `perCallTimeoutMs` 8000 → 12000 on production (AGENT-OPS-1)

## Scope
- **Env:** production. Supabase project `uzimqndenngebzgndlhd`. One row: omc, restaurant `2e578557-e903-4b1d-877e-598b43956c39`.
- **Change:** one key in `restaurants.agent_config`, `perCallTimeoutMs` 8000 → **12000**, with `rev` 10 → **11**.
  No deploy, no code change, no other tenant, no WhatsApp send.
- **Why:** on most turns the primary model (`gemini-3.5-flash-lite`) hits the 8 s cap, so the fallback model answers
  in 9–17 s. 12 s gives the primary room. The 20 s job budget (`JOB_BUDGET_MS`) is unchanged.
- **Go:** owner, 2026-11-20 ("2y"), for this one key on omc only.
- **Bounds:** `AGENT_NUMBER_RANGES.perCallTimeoutMs` is 3000..15000, integer (`src/domain/value-objects/agent-config.ts:110`).
  12000 is inside it, so it is not clamped.

## Pre-flight
- SSH (22) to the box is firewalled. Everything ran as Forge site commands on `app.ohmyclient.io`
  (server 1149990, site 3123752) as the site user.
- SQL went through the Supabase Management API from the box (`POST /v1/projects/<ref>/database/query`, `/read-only`
  for reads). `SUPABASE_ACCESS_TOKEN` was read from the site `.env` in the helper's memory and passed to curl on
  stdin (`-K -`). It never appeared in argv, a file or any output.
- Helper `/home/forge/ops1-tmp/q.sh` (sha256 `ebad108af66e94f6…`, equal to the local copy), uploaded base64 in the
  command. Deleted after the run (Cleanup).

## Runbook (as executed)
| time (UTC) | Forge command | step | result |
|---|---|---|---|
| 05:30:29 | 14471958 | GET-before (read-only) | 1 row: rev **10**, `perCallTimeoutMs` **8000**, mode `auto`, 20 keys. Matches the brief, so go |
| 05:31:59 | 14471982 | worker log baseline | `daemon-801730.log` at 53,137 lines; last `agent.reply` at 04:25:11Z |
| 05:32:00.931 | 14471982 | CAS UPDATE | **1 row** returned: rev 11, `perCallTimeoutMs` 12000 |
| 05:32:01.908 | 14471982 | read-back (read-only) | rev 11, `perCallTimeoutMs` 12000, 20 keys |

The write merges into the stored object and is keyed on both the read rev and the read value:
```sql
UPDATE restaurants
SET agent_config = agent_config || jsonb_build_object(
      'perCallTimeoutMs', 12000,
      'rev', (agent_config->>'rev')::int + 1)
WHERE id = '2e578557-e903-4b1d-877e-598b43956c39'
  AND agent_config->>'rev' = '10'
  AND agent_config->>'perCallTimeoutMs' = '8000'
RETURNING id, agent_config, now() AS written_at;   -- 1 row, 05:32:00.930943Z
```

## Verification
### AC-1: before / after
| key | before (05:30:29Z) | after (05:32:01Z) |
|---|---|---|
| `rev` | 10 | **11** |
| `perCallTimeoutMs` | 8000 | **12000** |

The before and after objects were diffed key by key on the box:
- `keyset_equal True`, added `[]`, removed `[]`. 20 keys before and after.
- `changed ['perCallTimeoutMs', 'rev']`.
- `others_identical True`: every other key has the same value. That covers `mode` `auto`, `model`,
  `fallbackModel`, `enabledTools`, `maxOutputTokens`, `maxToolCalls`, `debounceMs`, the rate limits, `failureAction`
  and the text keys (`knowledge`, `instructions`, `disclosureText`).

Box copies, all in `/home/forge/backups/2026-11-20-agent-timeout/` (dir 700, files 600):

| file | bytes | sha256 |
|---|---|---|
| `omc-agent-config-before.json` | 2280 | `92807679a4c1683fec4426665d74ce13e7a6b543b242331dce677cdba4257244` |
| `omc-agent-config-update.json` (RETURNING) | 2284 | `550f9044d7c904b706caa5aea26ae31f789ada8097ec5974d2c197397b30eecd` |
| `omc-agent-config-after.json` | 2280 | `8c8c886d7a00e9fa6eb67d4f447a156690a3f0fdb918fa54bfbd6d3282c54df8` |

### AC-2: no restart needed
The worker reads `agent_config` from the database at the start of every job, with no cache:
- `src/application/agent/agent-deps.ts:69`: the worker's `getConfig` is `readAgentConfig`.
- `src/infrastructure/supabase/repositories/agent-config-repository.ts:20-28`: `readAgentConfig` runs
  `select('agent_config').eq('id', …).maybeSingle()` on each call.
- `src/application/agent/process-agent-reply.ts:476-482`: `process()` calls `deps.getConfig(key.restaurantId)` for each
  job, and `:357` passes `config.perCallTimeoutMs` into the model request.
- `src/infrastructure/gemini/agent-client.ts:246-251` (`callTimeout`): the primary call's timeout is
  `min(perCallTimeoutMs, remaining − FALLBACK_RESERVE_MS)`. The reserve is 5 s (`:87`) and the budget 20 s
  (`process-agent-reply.ts:80`). At about 20 s remaining, the primary call gets the full 12 s, and the fallback
  still has at least about 8 s minus the time already spent.

Next `agent.reply` after the change: **none came in during the window.**
- The worker log after line 53,137 was polled once a minute by Forge site commands from 05:32Z. The last poll was
  14472112 at 05:41:11Z, 9 min 10 s after the write.
- No `agent.*` line, no error line and no `Workers started` (no restart) appeared. omc's last turn before the change
  was at 04:25:11Z.
- The first omc turn after 05:32:00Z will be the first one to run with 12 s. To confirm it, read the next
  `agent.reply` line in `/home/forge/.forge/daemon-801730.log` after line 53,137.
- Judge the effect on `latencyMs`, plus whether the primary or the fallback model answered, over several turns,
  not one.

## Rollback (ready, NOT executed; ETR ≈ 1 min, no redeploy)
Put 8000 back. Bump `rev` forward rather than back to 10, because the dashboard form CAS-checks on the stored rev.
Key the write on the rev you read:
```sql
UPDATE restaurants
SET agent_config = agent_config || jsonb_build_object(
      'perCallTimeoutMs', 8000,
      'rev', (agent_config->>'rev')::int + 1)
WHERE id = '2e578557-e903-4b1d-877e-598b43956c39'
  AND agent_config->>'rev' = '11'
  AND agent_config->>'perCallTimeoutMs' = '12000'
RETURNING id, agent_config->>'rev' AS rev, agent_config->>'perCallTimeoutMs' AS per_call_timeout_ms;
```
Alternatively, an omc admin can set it back in Settings → AI agent → Advanced ("Max wait for the model per call (ms)").
The full rev-10 object is `omc-agent-config-before.json` on the box.

## Cleanup
| item | state |
|---|---|
| box `/home/forge/ops1-tmp/` (helper only, no secrets) | deleted 05:39:45Z (Forge command 14472085, `ls` confirms it is gone) |
| box `/home/forge/backups/2026-11-20-agent-timeout/` | kept as the rollback copy. Re-hashed at 05:39:45Z: all three sha256 unchanged |
| worktree `../whatsapp-crm--ops1` | removed after the push |
