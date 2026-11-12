#!/usr/bin/env bash
set -euo pipefail

# Forge Scheduled Job entrypoint for GET /api/cron/booking-reminders
# (BOOK-001 W3, spec AC-15). Runs every 5 minutes: each confirmed booking gets
# one reminder once it is within 3 hours of its time (Asia/Hong_Kong). Each
# reminder is claimed with a conditional UPDATE on reminder_sent_at before it
# is sent, so overlapping ticks cannot double-send.
#
# Timeout is under the 5-minute tick: a run is one indexed SELECT plus one
# claim and one WhatsApp send per due booking.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "${SCRIPT_DIR}/run-cron-endpoint.sh" \
  booking-reminders /api/cron/booking-reminders 240
