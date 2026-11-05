# Prod VM hung during the #97 deploy; every site on the box went down

**Date**: 2026-08-05
**Trigger**: Forge auto-deploy of `main` b8ffd8f (the #97 fix), 03:56 UTC
**Impact**: `app.ohmyclient.io` — and the other 16 Forge sites on the same box —
unreachable 03:5x–04:32 UTC. Two deploys failed. Recovered by a GCP hard reset.
**Related**: #56 / #83 (deploy.sh fail-loud guards), #97

## Problem

Merging PR #98 triggered Forge's auto-deploy. Mid-deploy the server stopped
responding: TCP still accepted on 22/80/443, but nothing answered — no SSH
banner, no HTTP. Forge's own deploy died with `Connection timed out during
banner exchange` and was marked **failed** at 04:06. GCP reported the instance
RUNNING throughout.

## Root cause

The box is far too small for an in-place `next build`:

| | |
|---|---|
| Instance | `ai-audit-poc`, GCP project `project-e4c348ae-a148-4701-b53`, zone `asia-southeast1-a` |
| Machine type | **e2-medium — 2 vCPU / 4 GB RAM**, 1 GB swap, 29 GB disk (84% used) |
| Forge server | id 1149990 `gcp-accurity-audit-poc`, static IP 34.158.58.133 |
| Sites on it | **17**, including app.ohmyclient.io (site 3123752) |

`deploy.sh` runs `npm ci` + `next build` on the production host. Measured during
the recovery deploy, that build alone drove available memory from 2074 MB to
~1000 MB and swap from 0 to **1001 MB of 1024 MB** — i.e. it finishes only just
inside the box's limits, and that was with the app daemon *not* running. When
the same build ran on 2026-08-05 03:56 against an already-loaded box, the kernel
thrashed hard enough that sshd could not answer, which is what Forge saw.

The serial console gave no evidence — its buffer had not been written since
2026-05-07, so there is no OOM trace to point at. The memory profile above is
the direct measurement that replaced it.

## Recovery (what actually worked)

1. `gcloud compute instances reset ai-audit-poc --zone asia-southeast1-a --project project-e4c348ae-a148-4701-b53`
   — SSH answered 23 s later. (`reset`, not `stop`/`start`: a hung guest ignores
   ACPI. The IP is a reserved static address `accurity-audit-poc`, so neither
   would have changed it — but that is worth re-checking before any stop.)
2. Site returned **502**: the interrupted `npm ci` had already deleted
   `node_modules`, so the app daemon crash-looped on `sh: 1: next: not found`
   and supervisor gave up (`FATAL — Exited too quickly`). The checkout was at the
   new commit while `.next` was still the 2026-07-28 build.
3. Re-triggered the deploy via the Forge API. `npm ci` + `next build` succeeded
   (new `BUILD_ID`), but the deploy was still marked **failed** at the last step:

   ```
   → Restarting daemons
     ✗ No live supervisor program for the app (fallback daemon-746791).
       A build without a restart is a failed deploy — aborting.
   ```

   The #56 guard is working as designed — it looks for a *live* program to
   restart, and there was none because the daemon was FATAL. It cannot start a
   dead daemon.
4. `sudo -n /usr/bin/supervisorctl start daemon-746791:*` → RUNNING, health 200.

## Prevention

- **The box needs headroom before the next deploy.** A build that peaks at 98%
  of swap has no margin, and the app daemon now holds memory the recovery build
  did not have to share with. Either resize to `e2-standard-2` (8 GB) or add
  several GB of swap. Both need root on the host (the `forge` user's sudoers
  entry only permits `supervisorctl`).
- **Better: stop building on the production host.** Build the standalone bundle
  in CI and ship the artifact; `next build` is the only step that needs GBs.
- **deploy.sh gap**: the restart guard aborts when the daemon is FATAL, which is
  exactly the state a half-finished deploy leaves behind — so the recovery deploy
  is guaranteed to be marked failed even when it worked. It should attempt
  `supervisorctl start` on a program in FATAL/STOPPED state before declaring the
  deploy a failure, and only abort if the program will not come up.
- Recovery runbook is steps 1–4 above; the daemon id for the app is 746791
  (`/home/forge/.forge/daemon-746791.log`).
