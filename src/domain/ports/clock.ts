/** Injected time source -- lets timestamp-dependent logic (idempotency TTLs,
 * rate-limit windows, coalescing buckets, retry backoff) be tested without
 * real delays. */
export interface Clock {
  now(): Date
}

/** Injected randomness source for auth nonces (X-OMC-Nonce, WI-2). Kept
 * separate from Clock so a test can hold time fixed while stepping through a
 * deterministic sequence of nonces. */
export interface NonceSource {
  next(): string
}
