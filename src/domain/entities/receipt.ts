export type ReceiptStatus =
  | 'processing'
  | 'pending_confirmation'
  | 'confirmed'
  | 'rejected'

export interface Receipt {
  id: string
  memberId: string
  restaurantId: string
  imageUrl: string | null
  totalAmount: number | null
  itemsJson: unknown[] | null
  pointsAwarded: number
  confidence: number | null
  status: ReceiptStatus
  pendingAmount: number | null
  processedAt: string | null
}
