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

import { JoinFormNotice, claimUrlFrom, joinNoticeReducer, INITIAL_JOIN_NOTICE, type JoinNotice } from '../join-form'

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
    expect(html).toContain('data-testid="join-error"')
    expect(html).not.toContain('wa.me')
    expect(html).not.toContain('join-claim-whatsapp')
  })

  // r6 J4: the error / already-member line is a feedback container.
  it('an error notice carries data-testid join-error; the claim notice does not', () => {
    expect(renderToStaticMarkup(<JoinFormNotice error="fields_required" claimUrl={null} />)).toContain('data-testid="join-error"')
    expect(renderToStaticMarkup(<JoinFormNotice error="" claimUrl={URL} />)).not.toContain('join-error')
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

  // r2 G4: the notice shows a claim OR an error, never a stale claim over a
  // fresh client-side validation error.
  describe('r2 G4: notice state', () => {
    const render = (n: JoinNotice) => renderToStaticMarkup(<JoinFormNotice error={n.error} claimUrl={n.claimUrl} />)

    it('AC-4: after the claim notice shows, a submit with an empty name shows the fields_required error', () => {
      let notice = joinNoticeReducer(INITIAL_JOIN_NOTICE, { type: 'claim', url: URL })
      expect(render(notice)).toContain('join-claim-whatsapp')

      notice = joinNoticeReducer(notice, { type: 'error', code: 'fields_required' })

      expect(render(notice)).toContain('join.fieldsRequired')
      expect(render(notice)).not.toContain('join-claim-whatsapp')
    })

    it('AC-4: a new submit resets both the claim and the error', () => {
      const withClaim = joinNoticeReducer(INITIAL_JOIN_NOTICE, { type: 'claim', url: URL })
      const withError = joinNoticeReducer(INITIAL_JOIN_NOTICE, { type: 'error', code: 'generic_error' })

      expect(joinNoticeReducer(withClaim, { type: 'reset' })).toEqual({ error: '', claimUrl: null })
      expect(joinNoticeReducer(withError, { type: 'reset' })).toEqual({ error: '', claimUrl: null })
      expect(render(joinNoticeReducer(withClaim, { type: 'reset' }))).toBe('')
    })

    it('a claim answer replaces an earlier error', () => {
      const withError = joinNoticeReducer(INITIAL_JOIN_NOTICE, { type: 'error', code: 'fields_required' })
      expect(joinNoticeReducer(withError, { type: 'claim', url: URL })).toEqual({ error: '', claimUrl: URL })
    })
  })
})
