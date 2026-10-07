// INT-001 WI-5 frozen acceptance suite (T-C3, T-L3, T-M6-adjacent).
// Source: plan §WI-5 "Tests (first)" + team-lead brief: DNS-rebinding test
// (first resolution public, second private -> must still connect to the
// pinned public IP or fail closed), metadata-IP test, redirect-refused
// test, signature-format round trip against a partner-side reference
// implementation written independently in this test file.

import { createHmac, timingSafeEqual } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { UndiciOutboundSender } from '../outbound-webhook-sender'
import { createLoopbackTestGuard, startLoopbackHttpsServer } from '@/test-utils/loopback-test-guard'
import { classifyDeliveryOutcome } from '@/domain/services/delivery-outcome'
import { signHmacSha256Hex } from '@/domain/services/webhook-signature'
import type { OutboundWebhookRequest } from '@/domain/ports/outbound-webhook-sender'

// Independent "partner-side" verifier -- deliberately NOT importing
// `verifyHmacSha256Hex` from webhook-signature.ts, so this test proves the
// WIRE FORMAT is correct against a from-scratch implementation of the
// documented contract, not merely that our own function agrees with itself.
function partnerVerifiesSignature(secret: string, header: string, rawBody: string): boolean {
  const match = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(header)
  if (!match) return false
  const [, t, v1] = match
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex')
  const a = Buffer.from(expected, 'hex')
  const b = Buffer.from(v1, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}

describe('UndiciOutboundSender -- guard rejections (no network reached, T-C3)', () => {
  it('rejects a non-https URL before any dispatch, quickly, permanent classification', async () => {
    const sender = new UndiciOutboundSender()
    const started = Date.now()
    const result = await sender.send({ url: 'http://partner.example.com/hook', body: '{}', headers: {} })
    const elapsed = Date.now() - started
    expect(result.ok).toBe(false)
    expect(result.status).toBeNull()
    expect(result.error?.title).toBe('invalid_url')
    expect(elapsed).toBeLessThan(1000)
    expect(classifyDeliveryOutcome(result)).toBe('permanent')
  })

  it('rejects a URL whose only resolved address is the GCE metadata IP, quickly, zero bytes sent', async () => {
    const resolve = vi.fn().mockResolvedValue([{ address: '169.254.169.254', family: 4 }])
    const sender = new UndiciOutboundSender({ resolve })
    const started = Date.now()
    const result = await sender.send({
      url: 'https://metadata-lookalike.example.test/hook',
      body: '{}',
      headers: {},
    })
    const elapsed = Date.now() - started
    expect(result.ok).toBe(false)
    expect(result.status).toBeNull()
    expect(result.error?.title).toBe('ssrf_rejected')
    expect(elapsed).toBeLessThan(1000)
    expect(classifyDeliveryOutcome(result)).toBe('permanent')
    expect(resolve).toHaveBeenCalledTimes(1)
  })

  it('rejects a host with one public and one private resolved address, zero bytes sent', async () => {
    const resolve = vi.fn().mockResolvedValue([
      { address: '203.0.113.10', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ])
    const sender = new UndiciOutboundSender({ resolve })
    const result = await sender.send({ url: 'https://mixed.example.test/hook', body: '{}', headers: {} })
    expect(result.ok).toBe(false)
    expect(result.error?.title).toBe('ssrf_rejected')
  })

  it('rejects userinfo in the URL before any dispatch', async () => {
    const sender = new UndiciOutboundSender()
    const result = await sender.send({
      url: 'https://user:pass@partner.example.test/hook',
      body: '{}',
      headers: {},
    })
    expect(result.ok).toBe(false)
    expect(result.error?.title).toBe('invalid_url')
  })
})

describe('UndiciOutboundSender -- real loopback delivery (T-C3 anti-rebinding, redirect, size/time bounds)', () => {
  it('delivers to the pinned loopback IP and records it on the request, using ONLY the first resolution even though a second call would return a private address', async () => {
    let requestCount = 0
    const server = await startLoopbackHttpsServer((_req, res) => {
      requestCount += 1
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end('{"ok":true}')
    })
    try {
      const guard = createLoopbackTestGuard({ allowedPort: server.port })
      // First (and, if the pin is honoured, ONLY) resolution: public/loopback.
      // A second call would return a private/metadata address -- proving the
      // connector never re-resolves once pinned (the anti-rebinding control
      // T-C3 exists for: "must still connect to the pinned public IP").
      const resolve = vi
        .fn()
        .mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }])
        .mockResolvedValue([{ address: '169.254.169.254', family: 4 }])
      const sender = new UndiciOutboundSender({
        resolve,
        isAddressAllowed: guard.isAddressAllowed,
        ca: guard.ca,
        allowedPorts: guard.allowedPorts,
      })
      const request: OutboundWebhookRequest = {
        url: `https://partner.example.test:${server.port}/hook`,
        body: '{"type":"member.created"}',
        headers: { 'Content-Type': 'application/json' },
      }
      const result = await sender.send(request)

      expect(result.ok).toBe(true)
      expect(result.status).toBe(200)
      expect(result.latencyMs).toBeGreaterThanOrEqual(0)
      expect(resolve).toHaveBeenCalledTimes(1)
      expect(requestCount).toBe(1)
      // Observability: the real adapter records the pin it dialled onto the
      // request object it was handed (per the port's own doc comment).
      expect(request.pinnedIp).toBe('127.0.0.1')
    } finally {
      await server.close()
    }
  })

  it('does not follow a 302 redirect to a private target; returns the real 3xx status, permanent classification, and the redirect target is never contacted', async () => {
    const server = await startLoopbackHttpsServer((_req, res) => {
      res.writeHead(302, { Location: 'http://localhost:6379/' })
      res.end()
    })
    try {
      const guard = createLoopbackTestGuard({ allowedPort: server.port })
      const sender = new UndiciOutboundSender({
        resolve: async () => [{ address: '127.0.0.1', family: 4 }],
        isAddressAllowed: guard.isAddressAllowed,
        ca: guard.ca,
        allowedPorts: guard.allowedPorts,
      })
      const result = await sender.send({
        url: `https://partner.example.test:${server.port}/hook`,
        body: '{}',
        headers: {},
      })
      expect(result.ok).toBe(false)
      expect(result.status).toBe(302)
      expect(classifyDeliveryOutcome(result)).toBe('permanent')
    } finally {
      await server.close()
    }
  })

  it('WI-6: extracts a plain-integer Retry-After header into retryAfterSec, so deliver-outbound-webhook.ts can honour a 429', async () => {
    const server = await startLoopbackHttpsServer((_req, res) => {
      res.writeHead(429, { 'Retry-After': '120' })
      res.end()
    })
    try {
      const guard = createLoopbackTestGuard({ allowedPort: server.port })
      const sender = new UndiciOutboundSender({
        resolve: async () => [{ address: '127.0.0.1', family: 4 }],
        isAddressAllowed: guard.isAddressAllowed,
        ca: guard.ca,
        allowedPorts: guard.allowedPorts,
      })
      const result = await sender.send({
        url: `https://partner.example.test:${server.port}/hook`,
        body: '{}',
        headers: {},
      })
      expect(result.status).toBe(429)
      expect(result.retryAfterSec).toBe(120)
    } finally {
      await server.close()
    }
  })

  it('WI-6: an HTTP-date Retry-After (not a plain integer) is left unparsed -- retryAfterSec is undefined', async () => {
    const server = await startLoopbackHttpsServer((_req, res) => {
      res.writeHead(429, { 'Retry-After': 'Wed, 21 Oct 2026 07:28:00 GMT' })
      res.end()
    })
    try {
      const guard = createLoopbackTestGuard({ allowedPort: server.port })
      const sender = new UndiciOutboundSender({
        resolve: async () => [{ address: '127.0.0.1', family: 4 }],
        isAddressAllowed: guard.isAddressAllowed,
        ca: guard.ca,
        allowedPorts: guard.allowedPorts,
      })
      const result = await sender.send({
        url: `https://partner.example.test:${server.port}/hook`,
        body: '{}',
        headers: {},
      })
      expect(result.retryAfterSec).toBeUndefined()
    } finally {
      await server.close()
    }
  })

  it('bounds the response body it reads: an oversized response yields a truncated (<=512 char) excerpt without hanging', async () => {
    const server = await startLoopbackHttpsServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      // Far larger than both the internal read cap and the 512-char excerpt.
      res.end('x'.repeat(2_000_000))
    })
    try {
      const guard = createLoopbackTestGuard({ allowedPort: server.port })
      const sender = new UndiciOutboundSender({
        resolve: async () => [{ address: '127.0.0.1', family: 4 }],
        isAddressAllowed: guard.isAddressAllowed,
        ca: guard.ca,
        allowedPorts: guard.allowedPorts,
      })
      const started = Date.now()
      const result = await sender.send({
        url: `https://partner.example.test:${server.port}/hook`,
        body: '{}',
        headers: {},
      })
      const elapsed = Date.now() - started
      expect(result.ok).toBe(true)
      expect(result.responseExcerpt).not.toBeNull()
      expect(result.responseExcerpt!.length).toBeLessThanOrEqual(512)
      expect(elapsed).toBeLessThan(5000)
    } finally {
      await server.close()
    }
  })

  it('times out a hung response as transient, within the configured bound', async () => {
    const server = await startLoopbackHttpsServer((_req, res) => {
      // Never respond -- res.end() is never called.
      void res
    })
    try {
      const guard = createLoopbackTestGuard({ allowedPort: server.port })
      const sender = new UndiciOutboundSender({
        resolve: async () => [{ address: '127.0.0.1', family: 4 }],
        isAddressAllowed: guard.isAddressAllowed,
        ca: guard.ca,
        allowedPorts: guard.allowedPorts,
        timeoutMs: 200,
      })
      const started = Date.now()
      const result = await sender.send({
        url: `https://partner.example.test:${server.port}/hook`,
        body: '{}',
        headers: {},
      })
      const elapsed = Date.now() - started
      expect(result.ok).toBe(false)
      expect(result.status).toBeNull()
      expect(result.error?.title).toBe('timeout')
      expect(classifyDeliveryOutcome(result)).toBe('transient')
      expect(elapsed).toBeLessThan(2000)
    } finally {
      await server.close()
    }
  }, 10_000)

  it('always sends the fixed User-Agent header, ignoring any caller-supplied override', async () => {
    let seenUserAgent = ''
    const server = await startLoopbackHttpsServer((req, res) => {
      seenUserAgent = String(req.headers['user-agent'] ?? '')
      res.writeHead(200)
      res.end('ok')
    })
    try {
      const guard = createLoopbackTestGuard({ allowedPort: server.port })
      const sender = new UndiciOutboundSender({
        resolve: async () => [{ address: '127.0.0.1', family: 4 }],
        isAddressAllowed: guard.isAddressAllowed,
        ca: guard.ca,
        allowedPorts: guard.allowedPorts,
      })
      await sender.send({
        url: `https://partner.example.test:${server.port}/hook`,
        body: '{}',
        headers: { 'User-Agent': 'should-be-overridden' },
      })
      expect(seenUserAgent).toBe('OhMyClient-Webhooks/1')
    } finally {
      await server.close()
    }
  })

  it('signature header format round-trips against an independent partner-side HMAC verifier (T-L3)', async () => {
    const secret = 'partner-issued-secret-value-123456'
    const body = JSON.stringify({ id: 'evt_123', type: 'member.created' })
    let receivedHeader = ''
    let receivedBody = ''
    const server = await startLoopbackHttpsServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (c) => chunks.push(c))
      req.on('end', () => {
        receivedBody = Buffer.concat(chunks).toString('utf8')
        receivedHeader = String(req.headers['x-omc-signature'] ?? '')
        res.writeHead(200)
        res.end('ok')
      })
    })
    try {
      const guard = createLoopbackTestGuard({ allowedPort: server.port })
      const sender = new UndiciOutboundSender({
        resolve: async () => [{ address: '127.0.0.1', family: 4 }],
        isAddressAllowed: guard.isAddressAllowed,
        ca: guard.ca,
        allowedPorts: guard.allowedPorts,
      })
      const t = Math.floor(Date.now() / 1000).toString()
      const v1 = signHmacSha256Hex(secret, `${t}.${body}`)
      const header = `t=${t},v1=${v1}`
      const result = await sender.send({
        url: `https://partner.example.test:${server.port}/hook`,
        body,
        headers: { 'X-OMC-Signature': header, 'Content-Type': 'application/json' },
      })
      expect(result.ok).toBe(true)
      expect(receivedBody).toBe(body)
      expect(receivedHeader).toBe(header)
      expect(partnerVerifiesSignature(secret, receivedHeader, receivedBody)).toBe(true)
      // Tampering must fail the independent verifier too (sanity check on the
      // verifier itself, not just the happy path).
      expect(partnerVerifiesSignature(secret, receivedHeader, receivedBody + 'x')).toBe(false)
    } finally {
      await server.close()
    }
  })
})
