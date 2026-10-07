// MEM-001: per-contact delivery-quality rating shown in the members table.
// Window and thresholds live here (and only here) so the owner can tune them.

export type ContactQualityRating = 'green' | 'yellow' | 'red' | 'unknown'

export interface ContactQuality {
  rating: ContactQualityRating
  deliveryRate: number | null
  sampleSize: number
}

/** Outbound messages queued within this many days count toward the rate. */
export const CONTACT_QUALITY_WINDOW_DAYS = 90

/** rate >= green -> green; rate >= yellow -> yellow; below -> red. */
export const CONTACT_QUALITY_THRESHOLDS = { green: 0.9, yellow: 0.6 } as const

export const UNKNOWN_CONTACT_QUALITY: ContactQuality = {
  rating: 'unknown',
  deliveryRate: null,
  sampleSize: 0,
}

export interface ContactQualityInput {
  delivered: number
  failed: number
  unreachable: boolean
}

export function classifyContactQuality(input: ContactQualityInput): ContactQuality {
  const sampleSize = input.delivered + input.failed
  const deliveryRate = sampleSize === 0 ? null : input.delivered / sampleSize
  if (input.unreachable) return { rating: 'red', deliveryRate, sampleSize }
  if (deliveryRate === null) return { ...UNKNOWN_CONTACT_QUALITY }
  if (deliveryRate >= CONTACT_QUALITY_THRESHOLDS.green) return { rating: 'green', deliveryRate, sampleSize }
  if (deliveryRate >= CONTACT_QUALITY_THRESHOLDS.yellow) return { rating: 'yellow', deliveryRate, sampleSize }
  return { rating: 'red', deliveryRate, sampleSize }
}
