// Next.js server-boot hook (stable since Next 15, no config flag needed):
// `register()` runs ONCE per server instance, before the first request is
// served. INT-001 WI-19 (cold-Redis fix): warms the shared inbound-guard
// Redis client here so the first signed partner request after a deploy
// doesn't race the initial TCP handshake -- see
// src/infrastructure/queue/integration-inbound-queue.ts's
// getInboundRateLimiter()/warmInboundRateLimiter() for the full rationale.
//
// Guarded to the Node runtime: this file is also loaded under the Edge
// runtime (middleware), which has neither ioredis nor a use for this, and
// importing it there would throw at build/boot time.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  const { warmInboundRateLimiter } = await import('@/infrastructure/queue/integration-inbound-queue')
  await warmInboundRateLimiter()
}
