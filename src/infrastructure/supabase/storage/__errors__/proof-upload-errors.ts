export type ProofUploadValidationReason =
  | 'unsupported_mime'
  | 'file_too_large'

export class ProofUploadValidationError extends Error {
  readonly reason: ProofUploadValidationReason

  constructor(reason: ProofUploadValidationReason) {
    super(`Proof upload validation failed: ${reason}`)
    this.name = 'ProofUploadValidationError'
    this.reason = reason
  }
}
