export const DEFAULT_COMMISSION_HKD = 0.05
export const MAX_COMMISSION_HKD = 1

export function isValidCommissionRate(rate: number): boolean {
  if (!Number.isFinite(rate)) return false
  return rate >= 0 && rate <= 1
}
