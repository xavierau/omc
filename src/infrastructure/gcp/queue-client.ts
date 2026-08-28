import { processReceipt } from '@/application/process-receipt'
import { addReceiptJob } from '@/infrastructure/queue/receipt-queue'

export async function enqueueReceiptProcessing(params: {
  restaurantId: string
  memberId: string
  phone: string
  imageUrl: string
  imageId?: string
  phoneNumberId?: string
}): Promise<void> {
  const redisUrl = process.env.REDIS_URL

  if (!redisUrl) {
    console.warn('[Queue] No REDIS_URL — processing synchronously')
    await processReceipt(
      params.restaurantId,
      params.memberId,
      params.phone,
      params.imageUrl,
      params.imageId,
      params.phoneNumberId
    )
    return
  }

  await addReceiptJob(params)
}
