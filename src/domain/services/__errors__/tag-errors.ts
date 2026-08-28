// TAG-001: typed domain errors for tags. Mirrors the ImportBatchValidationError
// shape (machine-readable `reason` discriminant) so API routes can map a
// validation failure to an HTTP status. Repository-level conflict/not-found
// errors (unique-violation 23505 → 409, missing row → 404) live with the
// tag repository, not here.

export type TagValidationReason = 'empty_name' | 'name_too_long'

export class TagValidationError extends Error {
  constructor(
    public readonly reason: TagValidationReason,
    message?: string
  ) {
    super(message ?? reason)
    this.name = 'TagValidationError'
  }
}
