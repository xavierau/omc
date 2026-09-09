// INT-001 T-C3: `UndiciOutboundSender` -- the ONLY code that actually makes
// an HTTP request to a partner-owned destination URL. Every `send()` call:
//   1. `assertSafeUrl` -- format checks (https, port 443, no userinfo, name
//      blocklist).
//   2. `resolveAndPin` -- resolves the hostname once, requires every
//      returned address to be public, pins ONE of them.
//   3. Dials the PINNED IP directly via a custom `connect.lookup` on a
//      fresh undici `Agent` (never a shared/pooled one -- the pin is valid
//      for this one attempt only) -- this is the anti-rebinding control:
//      the address checked in step 2 is the address dialled, no matter how
//      many times anything downstream asks to resolve the hostname again.
//   4. `servername` is set to the ORIGINAL hostname (not the IP) so TLS SNI
//      and certificate hostname validation still target the real name.
//   5. No redirect-follow interceptor is ever installed on the Agent, so a
//      3xx response comes back with its real status code untouched -- T-C3
//      requires redirects are "never followed", which this satisfies by
//      construction rather than by post-hoc detection.
//   6. Bounded timeout (`AbortSignal.timeout`) and bounded response read
//      (never drains an unbounded body) before producing the `DeliveryResult`.

import { request, Agent } from 'undici'
import type { LookupFunction } from 'node:net'
import { assertSafeUrl, resolveAndPin, type AssertSafeUrlDeps, type ResolveAndPinDeps } from './ssrf-guard'
import type {
  DeliveryResult,
  OutboundWebhookRequest,
  OutboundWebhookSender,
} from '@/domain/ports/outbound-webhook-sender'

const DEFAULT_TIMEOUT_MS = 5000
const DEFAULT_MAX_RESPONSE_BYTES = 65536 // 64 KiB -- comfortably above the 512-char excerpt kept
const RESPONSE_EXCERPT_MAX_CHARS = 512
const USER_AGENT = 'OhMyClient-Webhooks/1'

export interface UndiciOutboundSenderDeps extends AssertSafeUrlDeps, ResolveAndPinDeps {
  /** Extra trusted CA cert(s) for the TLS connection. ONLY ever supplied by
   * `createLoopbackTestGuard()` in test code (a self-signed loopback test
   * cert) -- never in production, which always uses Node's default trust
   * store and always rejects an unverifiable certificate. */
  ca?: string | Buffer | Array<string | Buffer>
  timeoutMs?: number
  maxResponseBytes?: number
}

function errorResult(
  error: { title: string; details: string },
  latencyMs: number
): DeliveryResult {
  return { ok: false, status: null, latencyMs, responseExcerpt: null, error }
}

function classifyTransportError(err: unknown): { title: string; details: string } {
  const e = err as { name?: string; code?: string; message?: string } | undefined
  const name = e?.name ?? ''
  const code = e?.code ?? ''
  const message = e?.message ?? String(err)

  if (
    name === 'TimeoutError' ||
    name === 'AbortError' ||
    code === 'UND_ERR_ABORTED' ||
    code === 'UND_ERR_CONNECT_TIMEOUT' ||
    code === 'UND_ERR_HEADERS_TIMEOUT' ||
    code === 'UND_ERR_BODY_TIMEOUT'
  ) {
    return { title: 'timeout', details: message }
  }
  if (code === 'ECONNRESET') {
    return { title: 'connection_reset', details: message }
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return { title: 'dns_error', details: message }
  }
  return { title: 'network_error', details: message }
}

async function readBoundedExcerpt(
  body: AsyncIterable<Uint8Array> & { destroy?: (err?: Error) => void },
  maxBytes: number
): Promise<string | null> {
  const chunks: Buffer[] = []
  let total = 0
  let truncated = false

  try {
    for await (const chunk of body) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      const remaining = maxBytes - total
      if (remaining <= 0) {
        truncated = true
        break
      }
      const slice = buf.length > remaining ? buf.subarray(0, remaining) : buf
      chunks.push(slice)
      total += slice.length
      if (total >= maxBytes) {
        truncated = true
        break
      }
    }
  } catch {
    // Body stream errored mid-read -- keep whatever was already captured.
  } finally {
    if (truncated) {
      // Do not keep draining a response the sender decided not to fully
      // read; release the underlying socket instead of waiting it out.
      try {
        body.destroy?.()
      } catch {
        // best-effort cleanup only
      }
    }
  }

  if (total === 0) return null
  const text = Buffer.concat(chunks, total).toString('utf8')
  return text.slice(0, RESPONSE_EXCERPT_MAX_CHARS)
}

export class UndiciOutboundSender implements OutboundWebhookSender {
  constructor(private readonly deps: UndiciOutboundSenderDeps = {}) {}

  async send(req: OutboundWebhookRequest): Promise<DeliveryResult> {
    const startedAt = Date.now()

    const safe = assertSafeUrl(req.url, { allowedPorts: this.deps.allowedPorts })
    if (!safe.ok) {
      return errorResult(safe.error, Date.now() - startedAt)
    }

    const pin = await resolveAndPin(safe.hostname, {
      resolve: this.deps.resolve,
      isAddressAllowed: this.deps.isAddressAllowed,
    })
    if (!pin.ok) {
      return errorResult(pin.error, Date.now() - startedAt)
    }

    // Observability for tests/logging: record which address this attempt
    // actually pinned. See the port's own doc comment on `pinnedIp`.
    req.pinnedIp = pin.ip

    const lookup: LookupFunction = (_hostname, options, callback) => {
      // Ignores whatever it is asked to resolve and always returns the
      // pinned address -- this IS the anti-rebinding control: no matter how
      // many times the transport calls this, or what DNS says by then, the
      // address dialled for the lifetime of this one attempt never changes.
      //
      // Node's Happy Eyeballs connector (net's default since autoSelectFamily
      // landed) calls this with `{ all: true }` and expects an ARRAY back;
      // without `all`, it expects a single `(address, family)` pair. Both
      // shapes must resolve to the same one pinned address.
      if (options && typeof options === 'object' && 'all' in options && options.all) {
        callback(null, [{ address: pin.ip, family: pin.family }])
        return
      }
      callback(null, pin.ip, pin.family)
    }

    const agent = new Agent({
      connect: {
        lookup,
        servername: safe.hostname,
        ca: this.deps.ca,
      },
    })

    const timeoutMs = this.deps.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const maxResponseBytes = this.deps.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES

    try {
      const response = await request(safe.url, {
        method: 'POST',
        body: req.body,
        // `req.headers` may pass through domain-level headers (signature,
        // event id, content type); User-Agent is always the fixed,
        // documented value regardless of what the caller supplies.
        headers: { ...req.headers, 'User-Agent': USER_AGENT },
        dispatcher: agent,
        signal: AbortSignal.timeout(timeoutMs),
        // No `redirect` interceptor is ever added to `agent` -- undici's
        // low-level request() never follows redirects on its own, so any
        // 3xx status comes back untouched with its real code (T-C3: never
        // followed).
      })

      const excerpt = await readBoundedExcerpt(response.body, maxResponseBytes)
      const latencyMs = Date.now() - startedAt
      const ok = response.statusCode >= 200 && response.statusCode < 300
      return { ok, status: response.statusCode, latencyMs, responseExcerpt: excerpt }
    } catch (err) {
      return errorResult(classifyTransportError(err), Date.now() - startedAt)
    } finally {
      await agent.close().catch(() => {})
    }
  }
}
