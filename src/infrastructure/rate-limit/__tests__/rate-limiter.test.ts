import { FakeClock } from '@/test-utils/fake-clock'
import { FakeRateLimiter } from '@/test-utils/fake-rate-limiter'
import { runRateLimiterContract } from './rate-limiter.contract'

runRateLimiterContract('fake: FakeRateLimiter', () => new FakeRateLimiter(new FakeClock()))

// WI-2 adds a second call here, gated on INT001_TEST_REDIS_URL:
//   if (process.env.INT001_TEST_REDIS_URL) {
//     runRateLimiterContract('real: RedisRateLimiter', async () => new RedisRateLimiter(...))
//   }
