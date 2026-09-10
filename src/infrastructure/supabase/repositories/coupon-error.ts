/**
 * Classifier for coupon-insert errors. Split out of coupon-repository.ts to
 * keep that file under the 150-line limit (same pattern as coupon-factory /
 * coupon-mapper).
 */

/**
 * True when `err` is a Postgres unique-constraint violation (SQLSTATE 23505)
 * from a coupon insert — e.g. the migration-053 `uniq_coupon_campaign_member`
 * index firing on a duplicate claim/eager mint. Prefers the `.code` that
 * createCoupon preserves; falls back to the wrapped message so it stays robust
 * if a caller loses it.
 */
export function isCouponUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: string })?.code
  if (code === '23505') return true
  const message = (err as { message?: string })?.message ?? ''
  return (
    message.includes('23505') ||
    message.includes('duplicate key') ||
    message.includes('uniq_coupon_campaign_member')
  )
}
