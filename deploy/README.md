# Forge Deploy — First-Time Bootstrap

Production runs on a Laravel Forge–managed Ubuntu server. Forge handles git pull, working
directory, nginx config, and TLS. The repo's `deploy.sh` only handles app concerns: deps,
migrations, seeder, daemon restart.

**The build does not run on the server.** See [Release Pipeline](#release-pipeline).

## Release Pipeline

`next build` is the only deploy step that needs gigabytes, and this host cannot spare
them: an e2-medium (2 vCPU / **4 GB RAM** / 1 GB swap) shared by 17 Forge sites. It took
production down twice —

- **2026-08-05**: an in-place build drove available memory from 2074 MB to ~1000 MB and
  swap from 0 to 1001 MB of 1024. The kernel thrashed until sshd stopped answering and
  *every site on the box* went dark for ~40 minutes. Recovered by a GCP hard reset.
- **2026-08-23**: the TypeScript phase alone ran **64.6 minutes** and was still going
  when the VM rebooted, leaving a `.next/` with no `prerender-manifest.json`. The app
  daemon crash-looped eleven times, supervisor gave up (`FATAL`), and the next deploy —
  which built fine — aborted at the restart step because it will not restart a dead
  daemon. Site was 502 until someone ran `supervisorctl start` by hand.

So the build moved to the developer machine:

```
  you: git push origin main          ← source of truth, as always
  you: npm run build:release         ← builds locally, publishes the `release` branch
       └─ Forge sees release change  ← auto-deploy fires
          └─ deploy.sh on prod: install deps → migrate → seed → restart
```

`release` is an **orphan branch, force-pushed on every release**. It carries the source
tree at the released commit plus a complete `.next/`. It has no history on purpose: the
bundle is ~136 MB and this repo is public, so retaining every release would grow it
without bound. `RELEASE.json` at the branch root is the link back to the real commit —
`git log` on `release` cannot tell you what is running, but `RELEASE.json` can, and
`deploy.sh` echoes it into the deploy log.

### Secrets — read this before touching release.sh

`output: 'standalone'` copies the build machine's `.env` **verbatim** into
`.next/standalone/.env`. On 2026-08-23 that file on production was byte-identical to the
production `.env`: service role key, Kapso API key and webhook secret, Resend and Gemini
keys, the platform admin password — 24 variables. **`xavierau/omc` is public.**

`scripts/release.sh` deletes every `.env` from the bundle and then scans the result for
service_role JWTs and `sb_secret_`/`sbp_` keys, refusing to push if it finds any.
`deploy.sh` re-checks on arrival. Verified against the real production bundle: no secret
value from `.env` appears in it. The five variables that *do* appear are `APP_URL`,
`NEXT_PUBLIC_APP_URL`, `REDIS_URL`, `LAYOUT_SERVICE_URL` and `RESEND_FROM_EMAIL` — all
public or localhost, none carrying embedded credentials.

The server keeps its own `.env`; the bundle never needs one.

### Releasing

```bash
# on your machine, after your PR has merged to main
git checkout main && git pull
npm run build:release
```

The script refuses to run on a dirty tree or a `main` that is out of sync with the
remote — the release records its source commit, so the build has to match it.

Rehearse without publishing:

```bash
RELEASE_DRY_RUN=1 npm run build:release                        # build + scrub, no push
RELEASE_DRY_RUN=1 RELEASE_SKIP_BUILD=1 npm run build:release   # reuse .next/, packaging only
```

## Prerequisites

- Ubuntu 22.04+ provisioned via Laravel Forge
- Site provisioned with **Node.js 22+** and `npm`
- Repo connected via Forge UI to the **`release`** branch — *not* `main` (`deploy.sh`
  aborts on a branch with no `.next/`, rather than restarting into a stale build)
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
forge ALL=(ALL) NOPASSWD: /usr/bin/supervisorctl status
forge ALL=(ALL) NOPASSWD: /usr/bin/supervisorctl status *
forge ALL=(ALL) NOPASSWD: /usr/bin/supervisorctl start *
forge ALL=(ALL) NOPASSWD: /usr/bin/supervisorctl restart *
forge ALL=(ALL) NOPASSWD: /usr/bin/supervisorctl stop *
```

`restart` alone is not enough — an earlier revision of this file listed only that, and
`deploy.sh` also needs `status` (to decide whether a daemon is up) and `start` (to revive
one that supervisor has given up on). A missing entry does not fail loudly: `sudo -n`
just exits 1 with "a password is required", which the script reads as "daemon not found".

Note `deploy.sh` reads `/etc/supervisor/conf.d/` with a **plain** `grep`, not `sudo grep`.
That directory is world-readable (755 root:root) and `grep` is deliberately *not* in the
sudoers list — granting `sudo grep` would hand out read access to every file on the host.
An earlier revision used `sudo -n grep` there and silently matched nothing on every
deploy, quietly disabling the daemon-renumbering robustness it was written to provide.

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

## Forge Scheduled Jobs

Create under **Site → Scheduler**. Unlike Daemons (long-running processes),
Scheduled Jobs are cron-style: Forge invokes the command on the given
frequency and captures its output.

**Every `/api/cron/*` route must have a job here.** A cron route with no
caller is inert and invisible — it has bitten this project twice (#93
sync-templates, #95 campaigns). The full list is exactly the three below; if a
new route is added under `src/app/api/cron/`, it ships with a wrapper in
`scripts/cron/` and a row in this section, or it does nothing.

Each wrapper delegates to `scripts/cron/run-cron-endpoint.sh`, which reads
`CRON_SECRET`/`APP_URL` from the site `.env`, echoes the response JSON into
Forge's scheduler log, and fails loud (non-zero exit, response body on stderr)
on anything that is not a 2xx — including a **3xx**. Redirects are treated as
failures and not followed on purpose: an `http://` `APP_URL` that nginx
redirects to https would otherwise return an empty 302 that `curl -f` reports
as success, so every run would look green while the route was never invoked.
If a job fails with `HTTP 301`/`HTTP 308`, fix `APP_URL` — don't add `-L`.

### `campaigns`

- **Command**: `bash /home/forge/<site-dir>/scripts/cron/campaigns.sh`
- **User**: `forge`
- **Frequency**: Custom — `* * * * *`

Wraps `GET /api/cron/campaigns`. **This is the only producer of
scheduled-campaign jobs** — `getDueCampaigns()` has no other caller, and the
`ohmyclient-worker` daemon above is a *consumer*. Without this job the
`campaign-execution` queue has a consumer and no producer: scheduled
broadcasts never fire and only manually-executed campaigns send (issue #95).

Every minute, because a broadcast scheduled for 09:02 should go out at 09:02.

Double-send safety, for the record — an earlier revision of this file claimed
scheduling this endpoint "risks double-sends" and told you not to. That was
wrong, and it kept the bug alive. Two independent guards:

1. `executeCampaign` claims the row with a compare-and-swap (`active` →
   `sending`) before it sends anything. A second job for the same campaign
   loses the CAS and aborts.
2. The route leases each campaign (`campaigns.last_enqueued_at`, 5 min) before
   enqueueing, so overlapping ticks can't double-enqueue and a campaign that
   fails *before* the CAS — unapproved template, missing `phone_number_id`,
   execution-time guardrail — can't re-enqueue on all 1440 ticks a day.

**Verify the first run**: expect JSON with `enqueued`, `skipped`, `throttled`.
An all-zero response just means nothing was due.

### `sync-templates`

- **Command**: `bash /home/forge/<site-dir>/scripts/cron/sync-templates.sh`
- **User**: `forge`
- **Frequency**: Custom — `*/15 * * * *`

Wraps `GET /api/cron/sync-templates`, which existed for months with nothing
calling it in production (issue #93) — templates Meta approved sat `pending`
forever and silently blocked campaigns.

**Verify the first run**: expect JSON containing `restaurants` and `results`.

### `reconcile-orphan-messages`

- **Command**: `bash /home/forge/<site-dir>/scripts/cron/reconcile-orphan-messages.sh`
- **User**: `forge`
- **Frequency**: Custom — `*/10 * * * *`

Wraps `GET /api/cron/reconcile-orphan-messages`. Sweeps `whatsapp_messages`
rows stuck at `queued` with no `kapso_message_id` for over 5 minutes to
`failed`/`internal_orphan` — the two-phase send pattern strands rows there
whenever the worker dies mid-send, and unswept they skew every delivery-rate
report. Idempotent and bounded: one age-filtered UPDATE.

**Verify the first run**: expect JSON with `swept`. Zero is the normal steady
state.

### Verifying any of them

Forge UI → site → **Scheduler** → click the job → job output. Every run logs
an ISO timestamp, the URL it requested, and the response JSON. A `FAILED` run
means non-2xx or missing config — check `CRON_SECRET`/`APP_URL` in the site
`.env`, which is what the `forge` user's environment falls back to.

## Cutting Over to the Release Branch

One-time, in this order. Until step 2 the site keeps deploying from `main` exactly as
before, so there is no window where production is pointed at a branch that does not
exist yet.

1. **Publish the first release** from a dev machine:
   ```bash
   git checkout main && git pull
   npm run build:release
   ```
   Confirm the branch exists and carries a build:
   ```bash
   git ls-remote --heads origin release
   ```
2. **Repoint Forge**: Site → Repository → Branch → `release`. Leave *Quick Deploy*
   enabled — a push to `release` is what now triggers a deploy.
3. **Deploy once** from the Forge UI and watch the log. Expect `→ Verifying prebuilt
   bundle` to echo the source commit, and **no** `→ Building Next.js` step.
4. **Verify**: `curl -sf https://app.ohmyclient.io/api/health`, then log in as
   `PLATFORM_ADMIN_EMAIL` and confirm platform admin access.

**Rolling back the cutover** is repointing Forge at `main` — but note `deploy.sh` will
then abort at the bundle check, because `main` carries no `.next/`. To genuinely revert
to building on the server you also need the previous `deploy.sh` (`git show
<pre-cutover-sha>:deploy.sh`). Rolling back a *release* is the easy direction: check out
the last good commit and re-run `npm run build:release`.

## Routine Deploys

```bash
git checkout main && git pull    # after your PR merges
npm run build:release            # builds locally, force-pushes `release`, Forge deploys
```

Migrations are idempotent (Supabase tracks applied) and the platform admin seeder is
idempotent (no-op when the row exists). Every deploy is safe.

`npm ci` now runs only when `package-lock.json` actually changed — the installed tree is
stamped with the lockfile hash at `node_modules/.omc-lock-hash`. This skips ~1 GB of
churn on most deploys, and closes the window in which an interrupted install leaves the
box with no `node_modules` and a crash-looping daemon (which is how 2026-08-05 got
worse).

## Troubleshooting

| Issue | Where to look |
|-------|---------------|
| Deploy step failed | Forge UI → site → Deploy log |
| `✗ No .next/ in the checkout` | Forge is deploying `main`, not `release`. Site → Repository → Branch |
| `✗ Incomplete build: ... is missing` | The published bundle is truncated. Re-run `npm run build:release` |
| `✗ .next/standalone/.env is present` | **Rotate every credential in it**, then rebuild with `release.sh` |
| `✗ Supervisor has no program for the app` | Daemon was deleted/recreated — check Forge UI → Daemons, update the fallback id in `deploy.sh` |
| Daemon `FATAL` after deploy | `tail -50 /home/forge/.forge/<daemon-id>.log`. `deploy.sh` now starts a FATAL daemon rather than aborting, so this means it crash-looped on the *new* bundle |
| Disk full mid-deploy | `npm cache clean --force`; `sudo journalctl --vacuum-size=200M`; `sudo apt-get clean` |
| Migration error | `supabase/migrations/`; check Supabase project logs |
| Worker not processing jobs | `journalctl -u supervisord -f` and worker daemon log |
| App 5xx | App daemon log; `journalctl -u supervisord -f` |
| Auth 401 from seeder | Check `SUPABASE_SERVICE_ROLE_KEY` in Forge env |
| `sudo` prompt during deploy | Confirm `/etc/sudoers.d/forge-supervisor` exists and is valid (`sudo visudo -c`) |

Daemon logs are typically at `/home/forge/.forge/<daemon-id>.log` (path varies — see
the Daemon detail page in Forge UI).
