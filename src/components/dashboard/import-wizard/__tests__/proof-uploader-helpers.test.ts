import { describe, it, expect } from 'vitest'
import {
  validateProofFile,
  PROOF_MAX_SIZE,
} from '@/components/dashboard/import-wizard/proof-uploader-helpers'

describe('validateProofFile', () => {
  it('accepts jpeg under size limit', () => {
    expect(validateProofFile({ type: 'image/jpeg', size: 1024 })).toBeNull()
  })

  it('accepts png, webp, pdf', () => {
    expect(validateProofFile({ type: 'image/png', size: 1024 })).toBeNull()
    expect(validateProofFile({ type: 'image/webp', size: 1024 })).toBeNull()
    expect(validateProofFile({ type: 'application/pdf', size: 1024 })).toBeNull()
  })

  it('rejects unsupported mime type', () => {
    expect(validateProofFile({ type: 'image/gif', size: 1024 })).toEqual({
      kind: 'wrongType',
    })
  })

  it('rejects file over 10 MB', () => {
    expect(
      validateProofFile({ type: 'image/jpeg', size: PROOF_MAX_SIZE + 1 })
    ).toEqual({ kind: 'tooLarge' })
  })

  it('accepts file at exactly 10 MB', () => {
    expect(
      validateProofFile({ type: 'image/jpeg', size: PROOF_MAX_SIZE })
    ).toBeNull()
  })
})
