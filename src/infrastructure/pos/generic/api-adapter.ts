import type { PosApiPort } from '@/domain/ports/pos-api'

export function createGenericApiAdapter(): PosApiPort {
  return {
    async verifyTransaction() {
      return null
    },
  }
}
