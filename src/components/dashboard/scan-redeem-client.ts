'use client'

import type { useTranslations } from 'next-intl'

type T = ReturnType<typeof useTranslations>

export interface CouponInfo {
  code: string
  type: string
  discountType: string | null
  discountValue: number | null
  expiresAt: string | null
  currentUses: number
  maxUses: number | null
  description: string | null
  status: string
  isActive: boolean
}

// Coupon lookup for redeem mode — preserves the original scan-page mapping verbatim.
export async function fetchCoupon(code: string): Promise<CouponInfo | null> {
  try {
    const res = await fetch(`/api/coupons/${encodeURIComponent(code)}`)
    if (!res.ok) return null
    const data = await res.json()
    return {
      code: data.code,
      type: data.discountType ? (data.discountType === 'percentage' ? 'percentage' : 'fixed_amount') : '',
      discountType: data.discountType ?? null,
      discountValue: data.discountValue ?? null,
      expiresAt: data.expiresAt ?? null,
      currentUses: 0,
      maxUses: null,
      description: data.description ?? null,
      status: data.status ?? 'active',
      isActive: data.status === 'active',
    }
  } catch {
    return null
  }
}

// Redeem confirm — preserves the original POST + error-map behavior verbatim.
export async function redeemCoupon(
  code: string,
  t: T
): Promise<{ success: boolean; message: string }> {
  try {
    const res = await fetch('/api/dashboard/scan/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    })
    const data = await res.json()
    if (res.ok) return { success: true, message: t('redeemSuccess') }
    const errorMap: Record<string, string> = {
      not_found: t('couponNotFound'),
      wrong_restaurant: t('wrongRestaurant'),
      expired: t('expired'),
      already_redeemed: t('alreadyRedeemed'),
      not_redeemable: t('notRedeemable'),
    }
    return { success: false, message: errorMap[data.error] ?? data.message ?? t('couponNotFound') }
  } catch {
    return { success: false, message: t('couponNotFound') }
  }
}
