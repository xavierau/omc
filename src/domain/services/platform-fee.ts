/** Platform markup per broadcast message (HKD) */
export const BROADCAST_PLATFORM_FEE_HKD = 0.3

/** Platform fee per coupon redemption (HKD) */
export const REDEMPTION_PLATFORM_FEE_HKD = 0.3

/** Calculate total broadcast platform fee for a given message count */
export function calculateBroadcastFee(messageCount: number): number {
  return round2(messageCount * BROADCAST_PLATFORM_FEE_HKD)
}

/** Calculate total redemption platform fee for a given redemption count */
export function calculateRedemptionFee(redemptionCount: number): number {
  return round2(redemptionCount * REDEMPTION_PLATFORM_FEE_HKD)
}

/** Calculate combined platform fee (broadcast + redemption) */
export function calculateTotalPlatformFee(
  messageCount: number,
  redemptionCount: number
): number {
  return round2(
    calculateBroadcastFee(messageCount) +
      calculateRedemptionFee(redemptionCount)
  )
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}
