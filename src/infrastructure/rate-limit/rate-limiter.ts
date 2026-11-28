interface RateLimitEntry {
  timestamps: number[]
}

interface RateLimitOptions {
  maxRequests: number
  windowMs: number
}

interface RateLimitResult {
  success: boolean
  remaining: number
}

const store = new Map<string, RateLimitEntry>()

export function rateLimit(
  key: string,
  options: RateLimitOptions
): RateLimitResult {
  const now = Date.now()
  const windowStart = now - options.windowMs
  const entry = store.get(key)

  const timestamps = entry
    ? entry.timestamps.filter((t) => t > windowStart)
    : []

  if (timestamps.length >= options.maxRequests) {
    return { success: false, remaining: 0 }
  }

  timestamps.push(now)
  store.set(key, { timestamps })

  const remaining = options.maxRequests - timestamps.length
  return { success: true, remaining }
}
