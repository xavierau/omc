import crypto from 'crypto'
import { COUPON_CODE_LENGTH } from '@/lib/constants'

const CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function generateCouponCode(): string {
  const bytes = crypto.randomBytes(COUPON_CODE_LENGTH)
  return Array.from(bytes)
    .map((b) => CHARSET[b % CHARSET.length])
    .join('')
}

export function isValidCouponCode(code: string): boolean {
  return /^[A-Z0-9]{3,20}$/i.test(code)
}
