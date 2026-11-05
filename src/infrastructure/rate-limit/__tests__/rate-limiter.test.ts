import Redis from 'ioredis'
import { FakeClock } from '@/test-utils/fake-clock'
import { FakeRateLimiter } from '@/test-utils/fake-rate-limiter'
import { RedisRateLimiter } from '../redis-rate-limiter'
import { runRateLimiterContract } from './rate-limiter.contract'

runRateLimiterContract('fake: FakeRateLimiter', () => new FakeRateLimiter(new FakeClock()))

// Integration lane only -- gated on INT001_TEST_REDIS_URL, skipped in CI
// like every other real-adapter lane in this plan (WI-1 precedent).
if (process.env.INT001_TEST_REDIS_URL) {
  runRateLimiterContract(
    'real: RedisRateLimiter',
    () => new RedisRateLimiter(new Redis(process.env.INT001_TEST_REDIS_URL as string))
  )
}
