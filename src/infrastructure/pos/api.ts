import { createPosProvider } from './provider-factory'
import type { PosApiPort } from '@/domain/ports/pos-api'
import type { PosProvider } from '@/domain/entities/pos-integration'

export function getPosApi(provider: PosProvider): PosApiPort {
  return createPosProvider(provider).api
}
