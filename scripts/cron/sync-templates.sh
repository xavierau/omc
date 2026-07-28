#!/usr/bin/env bash
set -euo pipefail

# Forge Scheduled Job entrypoint for GET /api/cron/sync-templates (issue #93).
# The route had existed for months with nothing calling it in production —
# templates Meta approved sat `pending` forever, silently blocking campaigns.
#
# Env reading, fail-loud checks, and the `curl -K -` secret handling live in
# run-cron-endpoint.sh, shared with the other cron wrappers.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "${SCRIPT_DIR}/run-cron-endpoint.sh" \
  sync-templates /api/cron/sync-templates 300
