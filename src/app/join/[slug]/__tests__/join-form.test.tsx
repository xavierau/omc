// WONB-020 r1 F1 (AC-2): the join form's answer for an existing member --
// claim on WhatsApp when the route says so, plain "already a member" otherwise.
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import en from '@/messages/en.json'
import zhHK from '@/messages/zh-HK.json'

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string) => `${ns}.${key}`,
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

import { JoinFormNotice, claimUrlFrom } from '../join-form'

const URL = 'https://wa.me/85261234567?text=JOIN'

describe('slug join form: existing member answer (WONB-020 r1)', () => {
  it('reads the claim link only from a claim-on-WhatsApp answer with a wa.me URL', () => {
    expect(claimUrlFrom({ existing: true, claimOnWhatsApp: true, whatsappClaimUrl: URL })).toBe(URL)
    expect(claimUrlFrom({ existing: true })).toBeNull()
    expect(claimUrlFrom({ existing: true, claimOnWhatsApp: true })).toBeNull()
    expect(claimUrlFrom({ existing: true, claimOnWhatsApp: true, whatsappClaimUrl: 'javascript:alert(1)' })).toBeNull()
    expect(claimUrlFrom({})).toBeNull()
  })

  it('claim flag set -> the translated claim message and a link to wa.me ... ?text=JOIN', () => {
    const html = renderToStaticMarkup(<JoinFormNotice error="" claimUrl={URL} />)

    expect(html).toContain('data-testid="join-claim-whatsapp"')
    expect(html).toContain('join.claimOnWhatsApp')
    expect(html).toContain('data-testid="join-claim-whatsapp-link"')
    expect(html).toContain(`href="${URL}"`)
    expect(html).toContain('join.claimOnWhatsAppButton')
    expect(html).not.toContain('join.alreadyMember')
  })

  it('no claim flag -> plain alreadyMember, no WhatsApp link', () => {
    const html = renderToStaticMarkup(<JoinFormNotice error="already_member" claimUrl={null} />)

    expect(html).toContain('join.alreadyMember')
    expect(html).not.toContain('wa.me')
    expect(html).not.toContain('join-claim-whatsapp')
  })

  it('no error and no claim -> renders nothing', () => {
    expect(renderToStaticMarkup(<JoinFormNotice error="" claimUrl={null} />)).toBe('')
  })

  it('en and zh-HK carry the claim keys', () => {
    for (const messages of [en, zhHK] as Array<{ join: Record<string, string> }>) {
      expect(messages.join.claimOnWhatsApp).toBeTruthy()
      expect(messages.join.claimOnWhatsAppButton).toBeTruthy()
    }
    expect(en.join.claimOnWhatsApp).toMatch(/WhatsApp/)
    expect((zhHK as { join: Record<string, string> }).join.claimOnWhatsApp).toMatch(/WhatsApp/)
  })
})
