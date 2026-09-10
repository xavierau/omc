#!/usr/bin/env bash
set -euo pipefail

# Forge Scheduled Job entrypoint for GET /api/cron/reconcile-orphan-messages
# (issue #95, item 4 — same un-wired-route failure class as #93 and the
# campaigns job).
#
# Sweeps `whatsapp_messages` rows stuck at `queued` with no kapso_message_id
# for over 5 minutes to `failed/internal_orphan` — the two-phase send pattern
# (insert queued -> BSP call -> update sent) strands rows there whenever the
# worker dies mid-send. Unswept, they sit `queued` forever and quietly skew
# every delivery-rate report.
#
# Idempotent and bounded: a single UPDATE over an age-filtered slice. Running
# it more often than needed costs one no-op query.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "${SCRIPT_DIR}/run-cron-endpoint.sh" \
  reconcile-orphan-messages /api/cron/reconcile-orphan-messages 60
