export const DEFAULT_COMMISSION_HKD = 0.05
export const DEFAULT_REDEMPTION_COMMISSION_HKD = 0.10
export const MAX_COMMISSION_HKD = 1

export function isValidCommissionRate(rate: number): boolean {
  if (!Number.isFinite(rate)) return false
  return rate >= 0 && rate <= 1
}

export function isValidBroadcastRate(rate: number): boolean {
  return isValidCommissionRate(rate)
}

export function isValidRedemptionRate(rate: number): boolean {
  return isValidCommissionRate(rate)
}
