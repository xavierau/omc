// WAQ-013: live ops-alert dispatcher.
//
// Single entry point on top of the WAQ-003 audit trail. Routes per
// `routingFor(alert)` to the Slack notifier and isolates per-channel
// failures so one broken integration does not silence the others.
//
// Failure mode: NEVER throws. Alerting failures must NOT crash production.

import {
  routingFor,
  type OpsAlert,
  type AlertChannel,
} from '@/domain/value-objects/ops-alert'
import {
  createSlackNotifier,
  type SlackNotifier,
} from '@/infrastructure/notifications/slack-notifier'

export async function notifyOpsAlert(alert: OpsAlert): Promise<void> {
  const channels = expandChannels(routingFor(alert))
  const notifier = createSlackNotifier()
  await Promise.all(
    channels.map((channel) => sendOne(notifier, channel, alert))
  )
}

function expandChannels(routing: AlertChannel): Array<'cs' | 'platform'> {
  if (routing === 'both') return ['cs', 'platform']
  return [routing]
}

async function sendOne(
  notifier: SlackNotifier,
  channel: 'cs' | 'platform',
  alert: OpsAlert
): Promise<void> {
  try {
    await notifier.send({ channel, alert })
  } catch (err) {
    console.warn('[notify_ops_alert] channel_failed', {
      channel,
      kind: alert.kind,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
