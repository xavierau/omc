export class TenantPrefixError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TenantPrefixError'
  }
}

interface BuildUploadPathInput {
  restaurantId: string
  explicitPath: string | null
  mime: string
  now?: () => number
}

/**
 * Compute the final storage object path for a dashboard upload.
 *
 * - If caller supplied a non-empty `explicitPath`, use it verbatim after
 *   `assertTenantPrefix` validates the tenant scoping.
 * - Otherwise fall back to a tenant-scoped timestamped path so legacy
 *   callers (that don't send `path`) still land under `{restaurantId}/...`.
 */
export function buildUploadPath(input: BuildUploadPathInput): string {
  const explicit = input.explicitPath?.trim() ?? ''
  if (explicit !== '') {
    assertTenantPrefix(explicit, input.restaurantId)
    return explicit
  }
  const ts = (input.now ?? Date.now)()
  const ext = normalizeExt(input.mime)
  return `${input.restaurantId}/${ts}.${ext}`
}

/**
 * Reject any path whose first folder segment is not the caller's
 * restaurantId — this is the server-side guard that prevents one tenant
 * from writing into another tenant's prefix. Also rejects traversal
 * segments (`..`), control characters (ASCII < 32), and paths with
 * leading/trailing slashes so tenants can't escape their prefix or
 * confuse the storage layer.
 */
export function assertTenantPrefix(path: string, restaurantId: string): void {
  if (path.startsWith('/') || path.endsWith('/')) {
    throw new TenantPrefixError(
      `Upload path must start with "${restaurantId}/"`
    )
  }
  // Reject any ASCII control character (newline, tab, NUL, etc.).
  for (let i = 0; i < path.length; i++) {
    if (path.charCodeAt(i) < 32) {
      throw new TenantPrefixError(
        `Upload path must start with "${restaurantId}/"`
      )
    }
  }
  const segments = path.split('/')
  if (segments.some((s) => s === '..')) {
    throw new TenantPrefixError(
      `Upload path must start with "${restaurantId}/"`
    )
  }
  const first = segments[0]
  if (!first || first !== restaurantId || !path.includes('/')) {
    throw new TenantPrefixError(
      `Upload path must start with "${restaurantId}/"`
    )
  }
}

function normalizeExt(mime: string): string {
  // Safe default: an unknown/unsupported mime must not leak a `.bin`
  // blob into the bucket — mirrors the client helper's `png` default.
  const tail = mime.split('/')[1]
  if (!tail) return 'png'
  return tail === 'jpeg' ? 'jpg' : tail
}
