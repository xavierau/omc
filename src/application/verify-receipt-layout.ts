import {
  verifyReceiptLayout as callVerifyLayout,
  isLayoutServiceEnabled,
} from '@/infrastructure/layout-service/client'
import { getActiveTemplate } from '@/infrastructure/supabase/repositories/layout-template-repository'
import { updateReceipt } from '@/infrastructure/supabase/repositories/receipt-repository'

export async function verifyReceiptLayout(params: {
  receiptId: string
  restaurantId: string
  imageUrl: string
}): Promise<void> {
  if (!isLayoutServiceEnabled()) return

  const { receiptId, restaurantId, imageUrl } = params

  const active = await getActiveTemplate(restaurantId)
  if (!active) return

  const result = await callVerifyLayout(
    imageUrl,
    active.template_json,
    active.threshold
  )

  await updateReceipt(receiptId, {
    layout_score: result.score,
    layout_flags: buildFlags(result),
  })

  if (!result.passed) {
    await updateReceipt(receiptId, { status: 'flagged' })
  }
}

function buildFlags(result: {
  aspect_ratio_score: number
  region_match_score: number
  spatial_score: number
  missing_regions: string[]
  extra_regions: string[]
}) {
  return {
    aspect_ratio_score: result.aspect_ratio_score,
    region_match_score: result.region_match_score,
    spatial_score: result.spatial_score,
    missing_regions: result.missing_regions,
    extra_regions: result.extra_regions,
  }
}
