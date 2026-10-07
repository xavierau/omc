// INT-001 WI-5 frozen acceptance suite (T-M6): the URL validator shared by
// WI-8's settings save and WI-6's delivery-attempt pre-check must live in
// the application layer (not only the React form) and enforce the identical
// rules as the real delivery path -- see plan §"Ports with fake + real
// adapters" and threat model T-C4 mitigation ("The URL validator must live
// in the application layer that both the settings save and the delivery
// attempt call -- never only in the React form.").

import { describe, expect, it, vi } from 'vitest'
import { validateOutboundUrl } from '../validate-outbound-url'

describe('validateOutboundUrl', () => {
  it('accepts a plain https URL resolving to a public address', async () => {
    const resolve = vi.fn().mockResolvedValue([{ address: '203.0.113.10', family: 4 }])
    const result = await validateOutboundUrl('https://partner.example.com/hooks/omc', { resolve })
    expect(result.ok).toBe(true)
  })

  it('rejects http:// without ever attempting DNS resolution', async () => {
    const resolve = vi.fn()
    const result = await validateOutboundUrl('http://partner.example.com/hooks', { resolve })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.title).toBe('invalid_url')
    expect(resolve).not.toHaveBeenCalled()
  })

  it('rejects a URL whose host resolves to the GCE metadata IP', async () => {
    const resolve = vi.fn().mockResolvedValue([{ address: '169.254.169.254', family: 4 }])
    const result = await validateOutboundUrl('https://looks-fine.example.com/hooks', { resolve })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.title).toBe('ssrf_rejected')
  })

  it('rejects userinfo in the URL', async () => {
    const result = await validateOutboundUrl('https://user:pass@partner.example.com/hooks')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.title).toBe('invalid_url')
  })

  it('rejects a non-443 port', async () => {
    const result = await validateOutboundUrl('https://partner.example.com:8080/hooks')
    expect(result.ok).toBe(false)
  })

  it('rejects the localhost name blocklist', async () => {
    const result = await validateOutboundUrl('https://localhost/hooks')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.title).toBe('ssrf_rejected')
  })

  it('uses the real production blocklist by default (no override needed)', async () => {
    // No `deps` argument at all -- proves the save-time (WI-8) call site,
    // which will not inject a fake resolver, still gets real protection.
    const result = await validateOutboundUrl('https://169.254.169.254/hooks')
    expect(result.ok).toBe(false)
  })
})
