// Shared contract suite for `OutboundWebhookSender`. Runs against the fake
// (FakeOutboundSender, WI-1) always; WI-5 adds a second invocation against
// the real UndiciOutboundSender, dialling a `node:http` server on 127.0.0.1
// via `createLoopbackTestGuard()`, per plan §"Ports with fake + real
// adapters". WI-1 does not implement the real adapter or the loopback guard
// -- both depend on `ssrf-guard.ts`'s interface, which WI-5 defines.
//
// Does NOT end in `.test.ts` -- see `outbound-sender.test.ts` for the
// invocation.

import { describe, expect, it } from 'vitest'
import type { OutboundWebhookSender } from '@/domain/ports/outbound-webhook-sender'

export function runOutboundSenderContract(
  label: string,
  createSender: () => OutboundWebhookSender | Promise<OutboundWebhookSender>
): void {
  describe(`OutboundWebhookSender contract (${label})`, () => {
    it('send() resolves to a DeliveryResult without throwing', async () => {
      const sender = await createSender()
      const result = await sender.send({
        url: 'https://partner.example.com/hook',
        body: '{}',
        headers: { 'Content-Type': 'application/json' },
      })
      expect(typeof result.ok).toBe('boolean')
      expect(typeof result.latencyMs).toBe('number')
    })

    it('a successful send reports ok=true with a 2xx status', async () => {
      const sender = await createSender()
      const result = await sender.send({
        url: 'https://partner.example.com/hook',
        body: '{}',
        headers: {},
      })
      if (result.ok) {
        expect(result.status).not.toBeNull()
        expect(result.status! >= 200 && result.status! < 300).toBe(true)
      }
    })
  })
}
