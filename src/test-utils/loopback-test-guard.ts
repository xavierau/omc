// INT-001 WI-5: TEST-ONLY escape hatch for T-C3's SSRF guard.
//
// The outbound-sender contract suite's "real" lane needs to prove
// `UndiciOutboundSender` actually dials the pinned IP over a real TLS
// connection -- but the only address it's safe to bind a throwaway test
// server to is 127.0.0.1/loopback, and that address is (correctly) on the
// production blocklist (`isBlockedIp`, src/domain/services/ip-range.ts).
//
// This module carves out a single, narrow exception -- loopback only,
// nothing else -- for tests. It is NEVER imported from `src/infrastructure`
// or `src/application` (see `__tests__/loopback-test-guard-boundary.test.ts`
// for the structural check that enforces this): production code always
// resolves through the real `dns.lookup` and the real, unmodified
// blocklist.
//
// WI-1 named this file and its export by this exact shape (see
// artifacts/2026-09-10-int-001-wi1-backend.md, "Deferred / Tech Debt").

import { createServer as createHttpsServer, type Server as HttpsServer } from 'node:https'
import { isBlockedIp } from '@/domain/services/ip-range'
import { LOOPBACK_TEST_CERT_PEM, LOOPBACK_TEST_KEY_PEM } from './loopback-tls-fixture'

/** The self-signed cert/key pair used by `startLoopbackHttpsServer` below.
 * Valid for `127.0.0.1`, `::1`, `localhost`, and `partner.example.test` (a
 * reserved `.test` TLD name per RFC 6761 -- guaranteed to never resolve in
 * real DNS, which is what lets the sender's tests use it as the canonical
 * fake partner hostname and still prove pinning: the connection can only
 * ever succeed via the pinned-IP override, never via a real resolution
 * falling through). See the cert's SAN list. Committed as TS constants
 * rather than `.pem` files because this repo's `.gitignore` excludes
 * `*.pem` (see `loopback-tls-fixture.ts`'s own top comment). */
export function loadLoopbackTlsFixture(): { cert: string; key: string } {
  return { cert: LOOPBACK_TEST_CERT_PEM, key: LOOPBACK_TEST_KEY_PEM }
}

export interface LoopbackTestGuard {
  /** Resolves ANY hostname to the loopback address -- the contract suite
   * points a fake hostname (e.g. `partner.example.test`, which does not
   * really resolve) at the local test server through this override, which
   * is also how the "connects to the pinned IP, not a re-resolved one"
   * property gets proven: if the real adapter fell back to genuine DNS
   * instead of the pin, the connection would fail outright. */
  resolve: (hostname: string) => Promise<{ address: string; family: number }[]>
  /** Allows ONLY the loopback address through; every other address is
   * still checked against the real production blocklist. */
  isAddressAllowed: (ip: string) => boolean
  /** Trusted CA for the self-signed loopback cert, so the client performs a
   * real TLS handshake and real certificate validation against a name it
   * actually trusts -- never `rejectUnauthorized: false`, which would test
   * a weaker code path than production ever runs. */
  ca: string
  /** `assertSafeUrl` enforces port 443 only in production -- a throwaway
   * test server binds an ephemeral port instead (port 443 needs root and
   * would collide across parallel test runs). Set ONLY when `allowedPort`
   * is supplied; production never sets this. */
  allowedPorts?: Set<number>
}

export function createLoopbackTestGuard(opts: { loopbackIp?: string; allowedPort?: number } = {}): LoopbackTestGuard {
  const loopbackIp = opts.loopbackIp ?? '127.0.0.1'
  const { cert } = loadLoopbackTlsFixture()
  return {
    async resolve(_hostname: string) {
      return [{ address: loopbackIp, family: 4 }]
    },
    isAddressAllowed(ip: string) {
      if (ip === loopbackIp) return true
      return !isBlockedIp(ip)
    },
    ca: cert,
    allowedPorts: opts.allowedPort === undefined ? undefined : new Set([opts.allowedPort]),
  }
}

export type LoopbackRequestHandler = (
  req: import('node:http').IncomingMessage,
  res: import('node:http').ServerResponse
) => void

/** Spins up a throwaway HTTPS server on 127.0.0.1 (ephemeral port) using the
 * fixture cert, for the contract suite's real-adapter lane. Caller is
 * responsible for calling `close()` once done. */
export async function startLoopbackHttpsServer(
  handler: LoopbackRequestHandler
): Promise<{ port: number; close: () => Promise<void> }> {
  const { cert, key } = loadLoopbackTlsFixture()
  const server: HttpsServer = createHttpsServer({ cert, key }, handler)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('startLoopbackHttpsServer: server did not bind to a port')
  }
  return {
    port: address.port,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}
