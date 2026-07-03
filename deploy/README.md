# Forge Deploy — First-Time Bootstrap

Production runs on a Laravel Forge–managed Ubuntu server. Forge handles git pull, working
directory, nginx config, and TLS. The repo's `deploy.sh` only handles app concerns: deps,
migrations, seeder, build, daemon restart.

## Prerequisites

- Ubuntu 22.04+ provisioned via Laravel Forge
- Site provisioned with **Node.js 22+** and `npm`
- Repo connected to GitHub `main` branch via Forge UI
- Redis available locally (or via `REDIS_URL`)

## One-Time Server Setup

SSH in as `forge` and run the following once.

### 1. Install Supabase CLI globally

```bash
npm i -g supabase
```

### 2. Link the site to the Supabase project

```bash
cd /home/forge/<site-dir>
supabase link --project-ref <prod-ref>
```

This stores the link in `supabase/.temp/`. `supabase db push --linked` will use it on
every deploy. The `--include-all` flag applies every pending migration in
`supabase/migrations/`.

### 3. Configure passwordless sudo for `supervisorctl`

`deploy.sh` calls `sudo -n /usr/bin/supervisorctl restart ...`. Without a sudoers entry
the deploy will hang.

```bash
sudo visudo -f /etc/sudoers.d/forge-supervisor
```

Content:

```
forge ALL=(ALL) NOPASSWD: /usr/bin/supervisorctl restart *
```

Save with strict perms — `visudo` validates before writing.

## Forge Environment Variables

Set in the Forge UI under **Site → Environment**. Restart daemons after editing.

| Var | Notes |
|-----|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | From Supabase dashboard |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | From Supabase dashboard |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role — server only |
| `KAPSO_API_KEY` | WhatsApp BSP |
| `KAPSO_WEBHOOK_SECRET` | WhatsApp webhook HMAC |
| `GEMINI_API_KEY` | Receipt AI parsing |
| `LAYOUT_SERVICE_URL` | If layout service is hosted |
| `LAYOUT_SERVICE_API_KEY` | If layout service is hosted |
| `REDIS_URL` | Defaults to `redis://localhost:6379` |
| `PLATFORM_ADMIN_EMAIL` | First-time platform admin (idempotent seeder reads this) |
| `PLATFORM_ADMIN_PASSWORD` | First-time platform admin password |
| `APP_URL` | e.g. `https://app.ohmyclient.io` |
| `NEXT_PUBLIC_APP_URL` | Same as `APP_URL` |
| `CRON_SECRET` | Bearer token for `/api/cron/*` endpoints |
| `SLACK_WEBHOOK_URL_CS` | Optional — CS-channel quality alerts (WAQ-013) |
| `SLACK_WEBHOOK_URL_PLATFORM` | Optional — platform-channel quality alerts (WAQ-013) |
| `WAQ_TRACK_MESSAGES` | Set to `1` to enable outbound message tracking; unset = WAQ pipeline dormant |
| `WAQ_BATCH_DELAY_MS` | Optional — delay between campaign send chunks (default 1000) |
| `KAPSO_DEFAULT_OPTIN_TEMPLATE_ID` | Optional — platform-default UTILITY template for opt-in prompts (WONB-007) |

## Forge Daemons

Create under **Site → Daemons**. Forge wraps these in supervisord with the daemon name
`ohmyclient-app` and `ohmyclient-worker`. The deploy script restarts both as
`ohmyclient-app:*` and `ohmyclient-worker:*`.

### `ohmyclient-app`

- **Command**: `cd /home/forge/<site-dir> && node .next/standalone/server.js`
- **User**: `forge`
- **Directory**: `/home/forge/<site-dir>`

### `ohmyclient-worker`

- **Command**: `cd /home/forge/<site-dir> && npx tsx scripts/start-worker.ts`
- **User**: `forge`
- **Directory**: `/home/forge/<site-dir>`

This worker boots the BullMQ workers for `campaign-execution`,
`event-dispatch`, and `receipt-processing`. **All three must run** — campaign
broadcasts and event listeners depend on the first two; receipt verification
depends on the third.

## First Deploy

1. Push to `main` — Forge auto-pulls and runs `deploy.sh`
2. Watch the Forge deploy log — look for `✓ Deploy complete`
3. Verify health: `curl https://app.ohmyclient.io/api/health`
4. Log in as `PLATFORM_ADMIN_EMAIL` / `PLATFORM_ADMIN_PASSWORD` and confirm platform
   admin access (multi-tenant dashboard)

## Routine Deploys

Push to `main`. Migrations are idempotent (Supabase tracks applied) and the platform
admin seeder is idempotent (no-op when the row exists). Every deploy is safe.

## Troubleshooting

| Issue | Where to look |
|-------|---------------|
| Deploy step failed | Forge UI → site → Deploy log |
| Migration error | `supabase/migrations/`; check Supabase project logs |
| Worker not processing jobs | `journalctl -u supervisord -f` and worker daemon log |
| App 5xx | App daemon log; `journalctl -u supervisord -f` |
| Auth 401 from seeder | Check `SUPABASE_SERVICE_ROLE_KEY` in Forge env |
| `sudo` prompt during deploy | Confirm `/etc/sudoers.d/forge-supervisor` exists and is valid (`sudo visudo -c`) |

Daemon logs are typically at `/home/forge/.forge/<daemon-id>.log` (path varies — see
the Daemon detail page in Forge UI).
