// BOOK-003 review F6: poppy.json and the OpenAPI document carry absolute
// URLs built from NEXT_PUBLIC_APP_URL. Empty or non-https → null (the routes
// answer 500 server_error); http only for localhost outside production.
import { describe, it, expect } from 'vitest'
import { resolveAgentAppUrl } from '../agent-booking-settings'

describe('resolveAgentAppUrl (F6)', () => {
  it('keeps an https origin, without a trailing slash', () => {
    expect(resolveAgentAppUrl('https://app.ohmyclient.io', 'production')).toBe('https://app.ohmyclient.io')
    expect(resolveAgentAppUrl('https://app.ohmyclient.io/', 'production')).toBe('https://app.ohmyclient.io')
  })

  it.each([undefined, '', '   ', 'app.ohmyclient.io', 'http://app.ohmyclient.io', 'ftp://x.hk', 'https://', 'https://u:p@app.ohmyclient.io'])(
    'rejects %s',
    (raw) => expect(resolveAgentAppUrl(raw, 'production')).toBeNull()
  )

  it('allows http://localhost only outside production', () => {
    expect(resolveAgentAppUrl('http://localhost:3093', 'development')).toBe('http://localhost:3093')
    expect(resolveAgentAppUrl('http://127.0.0.1:3000', 'test')).toBe('http://127.0.0.1:3000')
    expect(resolveAgentAppUrl('http://localhost:3093', 'production')).toBeNull()
    expect(resolveAgentAppUrl('http://localhost.evil.hk', 'development')).toBeNull()
  })
})
