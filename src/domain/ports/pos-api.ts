export interface PosTransactionVerification {
  exists: boolean
  amount: number
  currency: string
  status: string
}

export interface PosApiPort {
  verifyTransaction(
    txId: string,
    creds: Record<string, unknown>
  ): Promise<PosTransactionVerification | null>

  applyDiscount?(
    txId: string,
    amount: number,
    creds: Record<string, unknown>
  ): Promise<boolean>
}
