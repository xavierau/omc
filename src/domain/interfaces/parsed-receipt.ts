export interface TamperAssessment {
  isSuspicious: boolean
  reasons: string[]
}

export interface ParsedReceipt {
  total: number
  items: { name: string; price: number }[]
  confidence: number
  currency: string
  receiptNumber: string | null
  merchantName: string | null
  tamperAssessment: TamperAssessment | null
}
