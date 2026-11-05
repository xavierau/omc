import type {
  DeliveryResult,
  OutboundWebhookRequest,
  OutboundWebhookSender,
} from '@/domain/ports/outbound-webhook-sender'

const DEFAULT_OK: DeliveryResult = {
  ok: true,
  status: 200,
  latencyMs: 1,
  responseExcerpt: null,
}

/** Fake `OutboundWebhookSender` -- records every request and replays a
 * scripted sequence of responses (repeating the last one once exhausted). */
export class FakeOutboundSender implements OutboundWebhookSender {
  readonly requests: OutboundWebhookRequest[] = []
  private responses: DeliveryResult[] = [DEFAULT_OK]
  private cursor = 0

  script(responses: DeliveryResult[]): void {
    if (responses.length === 0) throw new Error('FakeOutboundSender.script: responses must be non-empty')
    this.responses = responses
    this.cursor = 0
  }

  async send(request: OutboundWebhookRequest): Promise<DeliveryResult> {
    this.requests.push(request)
    const result = this.responses[Math.min(this.cursor, this.responses.length - 1)]
    this.cursor += 1
    return result
  }

  reset(): void {
    this.requests.length = 0
    this.responses = [DEFAULT_OK]
    this.cursor = 0
  }
}
