#!/usr/bin/env bash
set -euo pipefail

# Forge Scheduled Job entrypoint for GET /api/cron/campaigns (issue #95).
#
# That route is the ONLY producer of scheduled-campaign jobs — `getDueCampaigns`
# has no other caller, and `ohmyclient-worker` is a consumer only. With nothing
# invoking it, scheduled broadcasts never fired in production: the queue had a
# consumer and no producer, and only manually-executed campaigns ever sent.
#
# Runs every minute. The route leases each campaign before enqueueing
# (campaigns.last_enqueued_at), so an overlapping tick cannot double-enqueue
# and a campaign stuck in `active` cannot storm the queue.
#
# Timeout is well under the 60s tick: the route does one indexed SELECT plus a
# guardrail check per due campaign, and the actual sending happens in the
# BullMQ worker, not here.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "${SCRIPT_DIR}/run-cron-endpoint.sh" \
  campaigns /api/cron/campaigns 45
