// INT-001 WI-11: load test for the partner member-creation API against the
// plan's perf budgets (`.claude-workspace/plans/2026-09-10-int-001-member-creation-api.md`
// §Performance Budgets). See `docs/integrations/member-api-ops.md` §11 for
// when to run this.
//
// Two modes, chosen automatically by what's configured:
//
// 1. FULL HTTP mode (the primary ask) -- fires real HMAC-v2-signed POSTs at
//    a running `next dev` (or `next start`) + `npx tsx scripts/start-worker.ts`
//    + Redis + Postgres stack. Requires INT001_LOAD_INTEGRATION_ID and
//    INT001_LOAD_WEBHOOK_SECRET for a real, `status: 'active'`
//    `pos_integrations` row. This script never writes to Postgres itself
//    (create the test integration via the dashboard first) -- it only
//    drives HTTP load, so it's safe to point at any environment.
//    Measures: route p95/p50 latency, 429/503 rate at configured limits,
//    Redis memory delta, drain time (via the poll route).
//
// 2. REDIS-ONLY mode (automatic fallback when INT001_LOAD_INTEGRATION_ID is
//    unset) -- exercises the REAL `RedisRateLimiter` and HMAC signing code
//    this repo ships (not a reimplementation) directly against Redis, with
//    no HTTP server and no Postgres involved. Gives real numbers for the
//    Redis-bound budgets (rate-limiter throughput, the 429 trip point,
//    Redis memory delta, signing overhead) but CANNOT measure route
//    p95/p50, job wall-clock time, or drain time -- those need the full
//    stack. Use this when a suitable isolated Postgres/app environment
//    isn't available; the summary states plainly which budgets it could
//    not measure, rather than guessing at them.
//
// Usage:
//   # Redis-only (no integration configured):
//   REDIS_URL=redis://127.0.0.1:6379 npx tsx scripts/load/int001-inbound.ts
//
//   # Full HTTP mode:
//   INT001_LOAD_TARGET_URL=http://localhost:3100 \
//   INT001_LOAD_INTEGRATION_ID=<uuid> \
//   INT001_LOAD_WEBHOOK_SECRET=<64-hex-chars> \
//   REDIS_URL=redis://127.0.0.1:6379 \
//     npx tsx scripts/load/int001-inbound.ts
//
// Optional tuning: INT001_LOAD_REQUESTS (default 500), INT001_LOAD_DURATION_SEC
// (default 60), INT001_LOAD_CONCURRENCY (default 8).

import { randomBytes, createHash, randomUUID } from 'node:crypto'
import { Redis } from 'ioredis'
import { buildInboundBase, signHmacSha256Hex } from '@/domain/services/webhook-signature'
import { RedisRateLimiter } from '@/infrastructure/rate-limit/redis-rate-limiter'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379'
const TARGET_URL = process.env.INT001_LOAD_TARGET_URL ?? 'http://localhost:3100'
const INTEGRATION_ID = process.env.INT001_LOAD_INTEGRATION_ID ?? null
const WEBHOOK_SECRET = process.env.INT001_LOAD_WEBHOOK_SECRET ?? null
const TOTAL_REQUESTS = Number(process.env.INT001_LOAD_REQUESTS ?? 500)
const DURATION_SEC = Number(process.env.INT001_LOAD_DURATION_SEC ?? 60)
const CONCURRENCY = Number(process.env.INT001_LOAD_CONCURRENCY ?? 8)

const FULL_HTTP_MODE = INTEGRATION_ID !== null && WEBHOOK_SECRET !== null

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function sha256hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function nonce(): string {
  return randomBytes(24).toString('base64url').slice(0, 32)
}

function percentile(sortedMs: number[], p: number): number {
  if (sortedMs.length === 0) return NaN
  const idx = Math.min(sortedMs.length - 1, Math.ceil((p / 100) * sortedMs.length) - 1)
  return sortedMs[Math.max(0, idx)]
}

function summarizeLatencies(label: string, latenciesMs: number[]): void {
  const sorted = [...latenciesMs].sort((a, b) => a - b)
  console.log(
    `  ${label}: n=${sorted.length} p50=${percentile(sorted, 50).toFixed(1)}ms ` +
      `p95=${percentile(sorted, 95).toFixed(1)}ms p99=${percentile(sorted, 99).toFixed(1)}ms ` +
      `max=${sorted.length ? sorted[sorted.length - 1].toFixed(1) : 'n/a'}ms`
  )
}

async function redisMemoryBytes(redis: Redis): Promise<number> {
  const info = await redis.info('memory')
  const match = /used_memory:(\d+)/.exec(info)
  return match ? Number(match[1]) : NaN
}

function mb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB'
}

// ---------------------------------------------------------------------------
// Full HTTP mode: sign and fire real POSTs at a running server
// ---------------------------------------------------------------------------

interface RequestOutcome {
  status: number
  latencyMs: number
}

function buildSignedCreateRequest(): { body: string; headers: Record<string, string> } {
  const body = JSON.stringify({
    phone: `+8529${String(Math.floor(1000000 + Math.random() * 8999999))}`,
    consent_level: 'none', // avoid triggering real welcome sends against a live BSP during a load run
    name: 'Load Test',
    external_ref: `load-${randomUUID()}`,
  })
  const t = Math.floor(Date.now() / 1000).toString()
  const n = nonce()
  const base = buildInboundBase('member.create', INTEGRATION_ID as string, t, n, sha256hex(body))
  const signature = signHmacSha256Hex(WEBHOOK_SECRET as string, base)
  return {
    body,
    headers: {
      'Content-Type': 'application/json',
      'X-OMC-Timestamp': t,
      'X-OMC-Nonce': n,
      'X-OMC-Signature': `v2=${signature}`,
    },
  }
}

async function fireOne(): Promise<RequestOutcome> {
  const { body, headers } = buildSignedCreateRequest()
  const start = performance.now()
  const res = await fetch(`${TARGET_URL}/api/integrations/${INTEGRATION_ID}/members`, {
    method: 'POST',
    headers,
    body,
  })
  const latencyMs = performance.now() - start
  await res.arrayBuffer().catch(() => undefined) // drain body, don't inflate latency measurement above
  return { status: res.status, latencyMs }
}

async function runWorkerPool(total: number, concurrency: number): Promise<RequestOutcome[]> {
  const outcomes: RequestOutcome[] = []
  let dispatched = 0
  async function worker(): Promise<void> {
    while (dispatched < total) {
      dispatched += 1
      outcomes.push(await fireOne())
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker))
  return outcomes
}

async function runFullHttpMode(redis: Redis): Promise<void> {
  console.log(`\n=== FULL HTTP mode: ${TOTAL_REQUESTS} signed POSTs against ${TARGET_URL} ` +
    `(target ${DURATION_SEC}s, concurrency ${CONCURRENCY}) ===`)

  const memBefore = await redisMemoryBytes(redis)
  const wallStart = performance.now()
  const outcomes = await runWorkerPool(TOTAL_REQUESTS, CONCURRENCY)
  const wallSec = (performance.now() - wallStart) / 1000
  const memAfter = await redisMemoryBytes(redis)

  const byStatus = new Map<number, number>()
  for (const o of outcomes) byStatus.set(o.status, (byStatus.get(o.status) ?? 0) + 1)

  const accepted = outcomes.filter((o) => o.status === 202)
  const throttled = outcomes.filter((o) => o.status === 429 || o.status === 503)

  console.log(`  wall time: ${wallSec.toFixed(1)}s (budget: <=${DURATION_SEC}s for ${TOTAL_REQUESTS} req)`)
  console.log('  status codes:', Object.fromEntries(byStatus))
  console.log(`  429/503 rate: ${((throttled.length / outcomes.length) * 100).toFixed(2)}% (budget: <0.5%)`)
  summarizeLatencies('202-accepted latency (budget: p50<=60ms, p95<=200ms)', accepted.map((o) => o.latencyMs))
  console.log(`  Redis memory delta for ${accepted.length} accepted jobs: ${mb(memAfter - memBefore)}`)
  if (accepted.length > 0) {
    const perThousand = ((memAfter - memBefore) / accepted.length) * 1000
    console.log(`  -> extrapolated per 1k jobs: ${mb(perThousand)} (budget: <=16 MB per 10k waiting jobs)`)
  }

  if (throttled.length === 0) {
    console.log(
      '  NOTE: zero 429/503 responses observed -- this run did not exceed the configured ' +
        'per-integration limits (default 60/min burst 20, or the queue depth cap). That is ' +
        'expected at this burst size/duration; it does NOT prove the trip point is wired -- ' +
        'see the REDIS-ONLY section below for a direct assertion that it trips.'
    )
  }
}

// ---------------------------------------------------------------------------
// Redis-only mode: exercise the real RedisRateLimiter directly
// ---------------------------------------------------------------------------

async function runRedisOnlyMode(redis: Redis): Promise<void> {
  console.log('\n=== REDIS-ONLY mode (no INT001_LOAD_INTEGRATION_ID / INT001_LOAD_WEBHOOK_SECRET set) ===')
  console.log(
    '  Full HTTP-level budgets (route p95/p50, job wall-clock time, drain time, worker RSS) ' +
      'are NOT measured in this mode -- they require a running `next dev` + ' +
      '`npx tsx scripts/start-worker.ts` server pointed at a Postgres instance carrying ' +
      "this worktree's own migrations (069-072). Point INT001_LOAD_TARGET_URL / " +
      'INT001_LOAD_INTEGRATION_ID / INT001_LOAD_WEBHOOK_SECRET at such an environment to run ' +
      'the full mode instead.'
  )

  const limiter = new RedisRateLimiter(redis)
  const key = `loadtest:token-bucket:${randomUUID()}`
  const RATE_PER_MIN = 60
  const BURST = 20

  // 1. Signing overhead (pure CPU, no I/O) -- real HMAC primitive from the codebase.
  const SIGN_ITERATIONS = 5000
  const signStart = performance.now()
  for (let i = 0; i < SIGN_ITERATIONS; i += 1) {
    const body = JSON.stringify({ phone: '+85298765432', consent_level: 'none', i })
    const base = buildInboundBase('member.create', 'loadtest-integration', String(i), nonce(), sha256hex(body))
    signHmacSha256Hex('loadtest-secret', base)
  }
  const signMs = performance.now() - signStart
  console.log(`\n  HMAC sign+hash overhead: ${SIGN_ITERATIONS} ops in ${signMs.toFixed(1)}ms ` +
    `(${(signMs / SIGN_ITERATIONS).toFixed(4)}ms/op) -- pure CPU cost, not counted against ` +
    'the route latency budget separately, but bounds how much of it signing could plausibly own.')

  // 2. Token-bucket throughput + 429 trip point, against the REAL Lua-scripted limiter.
  const memBefore = await redisMemoryBytes(redis)
  const results: { allowed: boolean }[] = []
  const REQUESTS = BURST + 10 // deliberately exceed burst to prove the trip point
  for (let i = 0; i < REQUESTS; i += 1) {
    const r = await limiter.takeToken(key, { ratePerMin: RATE_PER_MIN, burst: BURST })
    results.push({ allowed: r.allowed })
  }
  const allowedCount = results.filter((r) => r.allowed).length
  const deniedCount = results.length - allowedCount
  console.log(
    `\n  Token bucket (rate=${RATE_PER_MIN}/min, burst=${BURST}): fired ${REQUESTS} requests ` +
      `back-to-back -> ${allowedCount} allowed, ${deniedCount} denied (429-equivalent).`
  )
  console.log(
    `  Trip point assertion: ${allowedCount === BURST && deniedCount === REQUESTS - BURST ? 'PASS' : 'FAIL'} ` +
      `(expected exactly ${BURST} allowed, ${REQUESTS - BURST} denied for a fresh key)`
  )

  // 3. Redis memory delta for 1k simulated idempotency-cache entries (mirrors int001:idem:* sizing).
  const IDEM_COUNT = 1000
  const idemMemBefore = await redisMemoryBytes(redis)
  const pipeline = redis.pipeline()
  for (let i = 0; i < IDEM_COUNT; i += 1) {
    pipeline.set(`loadtest:int001:idem:${randomUUID()}`, JSON.stringify({ jobId: `mj_${randomUUID()}` }), 'EX', 86400)
  }
  await pipeline.exec()
  const idemMemAfter = await redisMemoryBytes(redis)
  console.log(
    `\n  Redis memory for ${IDEM_COUNT} simulated int001:idem:* entries: ` +
      `${mb(idemMemAfter - idemMemBefore)} (budget: <=16 MB per 10k waiting jobs, i.e. <=1.6 MB per 1k)`
  )

  console.log(`\n  Overall Redis memory delta this run: ${mb((await redisMemoryBytes(redis)) - memBefore)}`)
}

// ---------------------------------------------------------------------------
// Cleanup + entry point
// ---------------------------------------------------------------------------

async function cleanupLoadtestKeys(redis: Redis): Promise<void> {
  const keys = await redis.keys('loadtest:*')
  if (keys.length > 0) await redis.del(...keys)
}

async function main(): Promise<void> {
  const redis = new Redis(REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 5000 })
  try {
    await redis.connect()
  } catch (err) {
    console.error(`Could not connect to Redis at ${REDIS_URL} -- nothing measured.`)
    console.error(`Missing dependency: a reachable Redis instance. Start one (e.g. \`redis-server\`) and re-run.`)
    console.error(err instanceof Error ? err.message : err)
    process.exitCode = 1
    return
  }

  console.log(`INT-001 load test -- ${FULL_HTTP_MODE ? 'FULL HTTP' : 'REDIS-ONLY'} mode`)
  console.log(`Redis: ${REDIS_URL}`)
  if (FULL_HTTP_MODE) console.log(`Target: ${TARGET_URL}, integration: ${INTEGRATION_ID}`)

  try {
    if (FULL_HTTP_MODE) {
      await runFullHttpMode(redis)
    } else {
      await runRedisOnlyMode(redis)
    }
  } finally {
    await cleanupLoadtestKeys(redis)
    redis.disconnect()
  }
}

main().catch((err) => {
  console.error('Load test failed:', err instanceof Error ? err.stack ?? err.message : err)
  process.exitCode = 1
})
