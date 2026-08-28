import { rateLimit } from './rate-limiter'

const ADMIN_RATE_LIMIT = {
  maxRequests: 60,
  windowMs: 60_000,
} as const

export function checkAdminRateLimit(
  userId: string
): { success: boolean; remaining: number } {
  return rateLimit(`admin:${userId}`, ADMIN_RATE_LIMIT)
}
