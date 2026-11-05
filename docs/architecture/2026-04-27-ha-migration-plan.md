# HA Migration Plan — Single VPS → Load-Balanced Multi-Server

**Status:** Plan only. Do not execute until trigger criteria met.
**Owner:** OhMyClient platform
**Reference architecture:** Phase 1 deploy in `docker-compose.yml` (one VPS, all services)

---

## 1. Trigger criteria — when to start

Begin HA migration when **any** of the following becomes true:

| Trigger | Why |
|---|---|
| Signed SLA with paying tenant | Contractual uptime requires multi-host |
| 20+ active tenants | Single-machine outage now affects revenue |
| Sustained CPU >70% on app box | Vertical scale exhausted; must scale out |
| Recurring downtime incidents | Operational pressure justifies the work |
| Worker queue depth >5 min sustained | Workers need to scale independently from web |

If none of the above, do not start. Pre-optimizing for HA before the trigger wastes 2–3 days you should spend on features.

## 2. Target architecture

```
                    ┌─────────────────────┐
                    │  Cloudflare / DNS   │
                    │  app.ohmyclient.io  │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │  Caddy / Traefik LB │  ← TLS terminates here
                    │  health-check both  │
                    └──┬──────────────┬───┘
                       │              │
              ┌────────▼─────┐  ┌─────▼────────┐
              │  app-1       │  │  app-2       │  ← Stateless Next.js
              │  Next.js :3K │  │  Next.js :3K │     (no Redis, no workers)
              └──────────────┘  └──────────────┘
                       │              │
                       └──────┬───────┘
                              │
              ┌───────────────┼────────────────┐
              ▼               ▼                ▼
        ┌──────────┐   ┌─────────────┐   ┌──────────────┐
        │ Upstash  │   │ Worker box  │   │ layout-svc   │
        │ Redis    │   │ BullMQ +    │   │ box (Python  │
        │ (mgd)    │   │ cron leader │   │ CV models)   │
        └──────────┘   └─────────────┘   └──────────────┘
                              │
                              ▼
                       ┌──────────────┐
                       │  Supabase    │  ← already managed-HA
                       │  (DB + Auth  │
                       │  + Storage)  │
                       └──────────────┘
```

Key choices:
- **Redis externalized** (managed) so app-1 and app-2 share state.
- **Workers on a single dedicated box** — BullMQ is concurrency-safe across multiple workers, but pinning to one box keeps log clarity and simplifies cron-leader.
- **Layout service on its own box** because of large in-memory ML models (DocLayout-YOLO, EfficientSAM). Duplicating it doubles RAM cost without throughput benefit at current scale.
- **Cron triggered externally** (Cloud Scheduler / GitHub Actions / Vercel Cron) hitting `/api/cron/campaigns` — guarantees single fire, leverages existing idempotency.

## 3. Migration steps — in order, each independently revertible

Total estimated work: **2–3 days** spread over 1–2 weeks of measurement windows.

### Step 1 — Externalize Redis (½ day)
1. Provision Upstash Redis (or Memorystore) in same region as VPS (asia-east1 / asia-east2).
2. Add `REDIS_URL` from Upstash to `.env.production` on existing VPS.
3. Drain in-flight BullMQ jobs: `docker compose stop app worker` (worker is part of app today).
4. Update `.env.production` to point at Upstash; restart.
5. Comment out `redis` service in `docker-compose.yml`.
6. Validate: receipts process, campaign jobs flow, redis-cli on Upstash shows queue keys.

**Rollback:** revert `REDIS_URL`, uncomment redis service, `docker compose up -d`.

### Step 2 — Externalize cron (½ day)
1. Audit `src/app/api/cron/campaigns/route.ts` — confirm it's idempotent and reads recent state from DB. If not, add an idempotency key check before any side effects.
2. Provision Cloud Scheduler job hitting `https://app.ohmyclient.io/api/cron/campaigns` on the existing schedule.
3. Add a shared `CRON_SECRET` header check in the route.
4. Confirm zero internal `setInterval` / `node-cron` schedulers exist (`grep`).
5. Run for 1 week with both old and new triggering to verify no double-fires (use audit log). Then disable old.

**Rollback:** disable Cloud Scheduler job, re-enable internal trigger.

### Step 3 — Split workers from app process (½ day)
Today, BullMQ workers run inside the same Next.js process as the web app. To deploy app-only servers, workers must run as a separate process.

1. Add a worker entry point: `src/worker.ts` that imports and runs the worker bootstrap currently triggered on app start.
2. Add a `worker` service to `docker-compose.yml` that runs `node dist/worker.js`.
3. Ensure the app process **does not** start workers when `WORKER_MODE=disabled`.
4. Run `worker` and `app` as separate containers on the same box first; verify jobs still process.
5. Now the `app` image is safe to run on multiple hosts.

**Rollback:** revert `WORKER_MODE` env var; workers boot inside app again.

### Step 4 — Provision app-2 (½ day)
1. New VPS, identical OS / Docker version.
2. Same image build, same `.env.production`, but `WORKER_MODE=disabled`.
3. `docker compose up -d app` only (no redis, no worker, no layout-service).
4. Test directly via box-2 IP: `curl http://<box2-ip>:3000/api/health`.
5. Smoke-test login + a couple of dashboard operations against box-2 directly.

**Rollback:** tear down box-2; no impact on production traffic.

### Step 5 — Provision load balancer (½ day)
Three options, pick one:

| Option | Pros | Cons |
|---|---|---|
| **Caddy on a small dedicated box** | Auto-TLS via Let's Encrypt; simplest config | One more box to manage |
| **Cloudflare LB** | No box; geo-aware; DDoS protection | Paid feature ($5+/mo) |
| **Traefik on app boxes (active-active)** | No extra box | Cert renewal coordination |

Recommended: **Caddy on a third small box** for clarity.

```caddyfile
app.ohmyclient.io {
    reverse_proxy {
        to app-1.internal:3000 app-2.internal:3000
        health_uri /api/health
        health_interval 10s
        health_timeout 3s
        lb_policy least_conn
    }
}
```

1. Provision LB box, install Caddy.
2. Add internal DNS (or `/etc/hosts`) for `app-1.internal`, `app-2.internal`.
3. Test with public DNS still pointing at old box; use a temporary subdomain like `lb.ohmyclient.io`.
4. Verify both backends receive traffic, health checks fail-over correctly.

**Rollback:** keep DNS on old box, decommission LB.

### Step 6 — DNS cutover (½ day, mostly waiting)
1. Lower DNS TTL on `app.ohmyclient.io` to 60s — do this **24 hours before** cutover.
2. Set up real-time error monitoring (Sentry / Logtail / fly-on-the-wall) before cutting over.
3. Update A record from old VPS IP → LB IP.
4. Watch error rate + health checks for 2 hours.
5. After 24h stable, raise TTL back to 300s+.

**Rollback:** revert DNS A record. Within 60s, traffic returns to old box.

### Step 7 — Decommission Phase 1 box (1 week later)
1. Keep old box running for 1 week as a hot standby.
2. After 1 week of clean metrics, snapshot the box, then tear down.

## 4. Risk mitigation

| Risk | Mitigation |
|---|---|
| Worker double-processing | BullMQ uses `lockDuration` already; verify in `bullmq` config. Pin workers to one box anyway. |
| Stale auth sessions | Supabase JWTs are stateless — no sticky sessions needed. Verified. |
| File uploads diverge between boxes | All uploads go to Supabase Storage directly; no local FS persistence used. Audit any `fs.writeFile` calls before Step 4. |
| Session pinning needed for next-intl | next-intl reads cookies; cookies are sent on every request — no pinning. |
| Cron double-fire during overlap window | Add `CRON_SECRET` + idempotency key check in `/api/cron/campaigns`. Run new + old in shadow mode for 1 week. |
| Redis migration loses queued jobs | Drain queue before cutover (Step 1.3). BullMQ jobs in `wait` state lost on Redis switch — accept ≤30s of unsent campaigns or schedule cutover during a low-traffic window. |
| Layout service overload (single box) | Add Cloud Run behind it later if RPS grows; layout-service is read-only against incoming uploads, easy to scale separately. |

## 5. Cost estimate (HKD/month, approximate)

| Component | Service | Cost |
|---|---|---|
| app-1, app-2 | Hetzner CX22 / DO Basic | ~HK$ 300 |
| worker box | Same tier | ~HK$ 150 |
| layout-service box | CX32 (more RAM) | ~HK$ 250 |
| LB box (Caddy) | CX11 / DO Basic | ~HK$ 80 |
| Upstash Redis | Pay-as-you-go | ~HK$ 0–80 |
| Cloud Scheduler | Free tier | HK$ 0 |
| Sentry / monitoring | Free tier | HK$ 0 |
| **Total** | | **~HK$ 780–860** |

Compared to Phase 1 (~HK$ 150/mo), HA is roughly 5–6× the infra cost. This is the right tradeoff once the trigger criteria fire — not before.

## 6. Pre-flight checklist (run before Step 1)

- [ ] All Phase 1 services have ≥1 month of stable uptime data
- [ ] Backups verified for Supabase + any local config
- [ ] All secrets documented in a password manager (1Password / Bitwarden)
- [ ] Runbook exists for Phase 1 deploys
- [ ] Sentry / error tracking configured
- [ ] `WORKER_MODE` flag introduced and tested
- [ ] `CRON_SECRET` introduced and verified
- [ ] No `fs.writeFile` outside `/tmp` in src/ (grep audit)
- [ ] No `setInterval` / `node-cron` schedulers in src/ (grep audit)

## 7. Open questions for future me

- **Q1.** Multi-region for Asia-Pacific tenants? Decide when first non-HK tenant signs.
- **Q2.** Auto-scale app tier to Cloud Run later? Trigger: 50+ tenants or burst traffic from a viral campaign.
- **Q3.** Geo-DNS for zh-HK vs en split? Probably never — both languages serve from same backend.
- **Q4.** Read replicas for Supabase? Supabase handles this; revisit if dashboard reads slow.
