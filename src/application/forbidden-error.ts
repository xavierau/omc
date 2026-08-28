// Application-layer authorization error. Thrown when a use case is invoked
// with insufficient privileges (e.g. a tenant user trying to call a
// platform-admin-only operation). The route layer should map this to HTTP 403.
export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ForbiddenError'
  }
}
