#!/usr/bin/env bash
set -euo pipefail

# Forge Scheduled Job entrypoint for GET /api/cron/booking-retention
# (BOOK-001 W3, threat model R19, PDPO DPP2). Runs daily: clears the diner's
# name and notes on bookings dated more than 180 days ago and stamps
# pii_purged_at; status, party size, dates and counts remain. Idempotent: one
# UPDATE filtered on pii_purged_at IS NULL.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "${SCRIPT_DIR}/run-cron-endpoint.sh" \
  booking-retention /api/cron/booking-retention 300
