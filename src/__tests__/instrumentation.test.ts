// INT-001 WI-19 (cold-Redis fix): src/instrumentation.ts's register() is
// Next.js's server-boot hook -- it must warm the inbound rate-limiter's
// Redis client on the Node runtime, and must NOT do so (or import ioredis
// at all) under the Edge runtime, which also loads this file (middleware).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const warmInboundRateLimiter = vi.fn().mockResolvedValue(undefined)
vi.mock('@/infrastructure/queue/integration-inbound-queue', () => ({ warmInboundRateLimiter }))

describe('instrumentation.register()', () => {
  const originalRuntime = process.env.NEXT_RUNTIME

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    if (originalRuntime === undefined) delete process.env.NEXT_RUNTIME
    else process.env.NEXT_RUNTIME = originalRuntime
  })

  it('warms the inbound rate limiter on the Node runtime', async () => {
    process.env.NEXT_RUNTIME = 'nodejs'
    const { register } = await import('../instrumentation')

    await register()

    expect(warmInboundRateLimiter).toHaveBeenCalledTimes(1)
  })

  it('does nothing on a non-Node runtime (e.g. edge)', async () => {
    process.env.NEXT_RUNTIME = 'edge'
    const { register } = await import('../instrumentation')

    await register()

    expect(warmInboundRateLimiter).not.toHaveBeenCalled()
  })
})
