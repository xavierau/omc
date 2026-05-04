// WAQ-013: Slack incoming-webhook adapter for ops alerts.
//
// Posture: alerting MUST NOT crash production code. Every failure mode
// (missing env, fetch reject, non-2xx) becomes a `console.warn` and a
// resolved promise. Persistence/audit lives in WAQ-003's emit-ops-alert.

import type { OpsAlert, AlertSeverity } from '@/domain/value-objects/ops-alert'

export interface SlackNotifier {
  send(args: { channel: 'cs' | 'platform'; alert: OpsAlert }): Promise<void>
}

const SEVERITY_COLOR: Record<AlertSeverity, string> = {
  info: '#9E9E9E',
  warn: '#FFC107',
  error: '#FF9800',
  critical: '#FF0000',
}

export function createSlackNotifier(): SlackNotifier {
  return {
    async send(args) {
      const url = resolveWebhookUrl(args.channel)
      if (!url) {
        console.warn('[slack_notifier] webhook_url_missing', {
          channel: args.channel,
          kind: args.alert.kind,
        })
        return
      }
      await postToSlack(url, args.alert, args.channel)
    },
  }
}

function resolveWebhookUrl(channel: 'cs' | 'platform'): string | undefined {
  return channel === 'cs'
    ? process.env.SLACK_WEBHOOK_URL_CS
    : process.env.SLACK_WEBHOOK_URL_PLATFORM
}

async function postToSlack(
  url: string,
  alert: OpsAlert,
  channel: 'cs' | 'platform'
): Promise<void> {
  const body = JSON.stringify(buildSlackPayload(alert))
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })
    if (!response.ok) warnNon2xx(channel, alert, response.status)
  } catch (err) {
    warnFetchFailed(channel, alert, err)
  }
}

function warnNon2xx(
  channel: 'cs' | 'platform',
  alert: OpsAlert,
  status: number
): void {
  console.warn('[slack_notifier] non_2xx', { channel, status, kind: alert.kind })
}

function warnFetchFailed(
  channel: 'cs' | 'platform',
  alert: OpsAlert,
  err: unknown
): void {
  console.warn('[slack_notifier] fetch_failed', {
    channel,
    kind: alert.kind,
    error: err instanceof Error ? err.message : String(err),
  })
}

function buildSlackPayload(alert: OpsAlert): Record<string, unknown> {
  return {
    attachments: [
      {
        color: SEVERITY_COLOR[alert.severity],
        title: buildTitle(alert),
        text: alert.message,
        fields: buildFields(alert),
      },
    ],
  }
}

function buildTitle(alert: OpsAlert): string {
  const sev = alert.severity.toUpperCase()
  return `[${sev}] ${alert.kind}`
}

function buildFields(alert: OpsAlert): Array<Record<string, unknown>> {
  const fields: Array<Record<string, unknown>> = [
    { title: 'Restaurant', value: alert.restaurantName ?? alert.restaurantId, short: true },
    { title: 'Restaurant ID', value: alert.restaurantId, short: true },
  ]
  if (alert.details && Object.keys(alert.details).length > 0) {
    fields.push({
      title: 'Details',
      value: '```' + JSON.stringify(alert.details, null, 2) + '```',
      short: false,
    })
  }
  return fields
}
