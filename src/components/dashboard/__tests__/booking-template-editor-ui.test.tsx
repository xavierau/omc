// BOOK-002 (AC-1..AC-6, R22): the booking message editor and the row badges.
// Rendered to static markup (no DOM in this suite); the pure editor model is
// tested directly.
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string, values?: Record<string, string>) =>
    values ? `${ns}.${key}(${Object.values(values).join('|')})` : `${ns}.${key}`,
}))

import { BookingTemplateEditorView } from '../booking-template-editor'
import { BookingTemplateStatusList } from '../booking-template-status-list'
import type { LanguageEditorProps } from '../booking-template-language-editor'
import { editorText, insertPlaceholder, previewText, templateEditResult } from '@/hooks/booking-template-editor-model'
import { parseBookingSettingsSummary } from '@/hooks/use-booking-availability'
import { validateBookingTemplateBody } from '@/domain/services/booking-template-body'
import { bookingTemplateBody } from '@/domain/services/booking-templates'
import type { BookingTemplateSlotView, BookingTemplateSlotViews } from '@/application/booking/booking-template-statuses'
import type { BookingTemplateStatuses } from '@/domain/services/booking-templates'

const noop = () => {}
const slot = (o: Partial<BookingTemplateSlotView> = {}): BookingTemplateSlotView => ({
  status: 'approved', candidate: null, customBody: null, approvedBody: null, defaultBody: 'Default {{date}} at {{time}} ok.',
  placeholders: ['name', 'restaurant', 'date', 'time', 'party_size'], ...o,
})
const slots = (confirmed: Partial<Record<'en' | 'zh_hk', Partial<BookingTemplateSlotView>>> = {}): BookingTemplateSlotViews => ({
  received: { en: slot(), zh_hk: slot() },
  confirmed: { en: slot(confirmed.en), zh_hk: slot(confirmed.zh_hk) },
  declined: { en: slot(), zh_hk: slot() },
  reminder: { en: slot(), zh_hk: slot() },
})
const statuses = Object.fromEntries(
  ['received', 'confirmed', 'declined', 'reminder'].map((k) => [k, { en: 'approved', zh_hk: 'approved' }])
) as BookingTemplateStatuses

const lang = (o: Partial<LanguageEditorProps> & { draft: string }): LanguageEditorProps => ({
  lang: 'en', check: validateBookingTemplateBody('confirmed', o.lang ?? 'en', o.draft), placeholders: ['name', 'date', 'time'],
  canEdit: true, saving: false, busy: false, outcome: null, onChange: noop, onSave: noop, onReset: noop, ...o,
})
const view = (languages: LanguageEditorProps[], canEdit = true) =>
  renderToStaticMarkup(<BookingTemplateEditorView kind="confirmed" canEdit={canEdit} languages={languages} onClose={noop} />)

const OK = 'Your table at {{restaurant}} is confirmed for {{date}} at {{time}}. Reply here if plans change.'

describe('editor view (AC-1)', () => {
  it('shows the text, a chip per allowed placeholder and a filled preview for each language', () => {
    const html = view([lang({ lang: 'zh_hk', draft: bookingTemplateBody('confirmed', 'zh_hk') }), lang({ draft: OK })])
    expect(html).toContain('data-testid="booking-template-editor-zh_hk-input"')
    expect(html).toContain('data-testid="booking-template-editor-en-chip-date"')
    expect(html).toMatch(/data-testid="booking-template-editor-en-preview"[^>]*>Your table at Kushiro is confirmed for 2026-11-20 at 19:30/)
    expect(html).toMatch(/data-testid="booking-template-editor-zh_hk-preview"[^>]*>[^<]*串燒居/)
  })

  it('renders a <script> body as text in the textarea and the preview, never as HTML (R22)', () => {
    const html = view([lang({ draft: '<script>alert(1)</script> on {{date}} at {{time}} ok' })])
    expect(html).not.toContain('<script>')
    expect(html).toMatch(/booking-template-editor-en-preview"[^>]*>&lt;script&gt;alert\(1\)&lt;\/script&gt; on 2026-11-20/)
  })
})

describe('errors and warnings (AC-4)', () => {
  it('an error is shown inline and disables Save', () => {
    const html = view([lang({ draft: 'See https://x.io on {{date}} at {{time}} ok' })])
    expect(html).toMatch(/data-testid="booking-template-editor-en-errors"[\s\S]*?<span>bookingSettings\.templates\.editor\.errors\.link/)
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*data-testid="booking-template-editor-en-save"/)
    expect(html).toContain('aria-invalid="true"')
  })

  it('a warning is shown and Save stays enabled', () => {
    const html = view([lang({ draft: `${OK} Enjoy a free drink.` })])
    expect(html).toContain('editor.warnings.promotional_term(free)')
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*data-testid="booking-template-editor-en-save"/)
  })

  it('the ratio warning names the language rule', () => {
    const html = view([lang({ lang: 'zh_hk', draft: '提提你:你在{{restaurant}}有{{party_size}}位的訂座:{{date}} {{time}}。' })])
    expect(html).toContain('editor.warnings.low_ratio_zh_hk(3.25)')
  })
})

describe('outcomes (AC-2, AC-5)', () => {
  it.each(['submitted', 'reset', 'already_live'] as const)('%s is announced as status', (kind) => {
    const html = view([lang({ draft: OK, outcome: { kind } })])
    expect(html).toMatch(new RegExp(`booking-template-editor-en-outcome" role="status"[^>]*>bookingSettings\\.templates\\.editor\\.outcome\\.${kind}`))
  })

  it.each(['error', 'forbidden', 'not_sent'] as const)('%s is announced as an alert', (kind) => {
    expect(view([lang({ draft: OK, outcome: { kind } })])).toContain('booking-template-editor-en-outcome" role="alert"')
  })

  // BOOK-002 F1 C4: Meta refused the edit at submission; saving again would not help.
  it("a rejected edit is an alert naming Meta's reason", () => {
    const html = view([lang({ draft: OK, outcome: { kind: 'rejected', reason: 'INVALID_FORMAT' } })])
    expect(html).toMatch(/booking-template-editor-en-outcome" role="alert"[^>]*>bookingSettings\.templates\.editor\.outcome\.rejected\(INVALID_FORMAT\)/)
  })

  it('a rejected edit without a reason says none was given', () => {
    const html = view([lang({ draft: OK, outcome: { kind: 'rejected', reason: null } })])
    expect(html).toContain('editor.outcome.rejected(bookingSettings.templates.editor.candidate.noReason)')
  })
})

describe('non-admin (AC-6)', () => {
  it('reads the text with no chips, Save or Reset', () => {
    const html = view([lang({ draft: OK, canEdit: false })], false)
    expect(html).toContain('readOnly=""')
    expect(html).toContain('editor.readOnly')
    expect(html).not.toContain('booking-template-editor-en-save')
    expect(html).not.toContain('booking-template-editor-en-reset')
    expect(html).not.toContain('booking-template-editor-en-chip-')
  })
})

describe('row badges (AC-2, AC-3)', () => {
  const list = (s: BookingTemplateSlotViews, canEdit = true) =>
    renderToStaticMarkup(<BookingTemplateStatusList statuses={statuses} editor={{ canEdit, slots: s }} onEdit={noop} />)

  it('pending edit: badge and "previous version still in use"', () => {
    const html = list(slots({ en: { candidate: { status: 'pending', reason: null } } }))
    expect(html).toMatch(/booking-template-editor-candidate-confirmed-en"[^>]*>bookingSettings\.templates\.editor\.candidate\.pending/)
    expect(html).toContain('editor.candidate.pendingNote(')
    expect(html).toContain('editor.candidate.oldInUse')
  })

  it("rejected edit: badge and Meta's reason", () => {
    const html = list(slots({ zh_hk: { candidate: { status: 'rejected', reason: 'INVALID_FORMAT' } } }))
    expect(html).toContain('booking-template-editor-candidate-confirmed-zh_hk')
    expect(html).toMatch(/editor\.candidate\.rejectedNote\([^)]*INVALID_FORMAT\)/)
  })

  it('approved edit (no candidate): only the live status badge', () => {
    const html = list(slots())
    expect(html).not.toContain('booking-template-editor-candidate-')
    expect(html).toContain('data-testid="booking-template-editor-open-confirmed"')
  })

  it('non-admins get "View text"', () => {
    expect(list(slots(), false)).toMatch(/booking-template-editor-open-received"[^>]*>bookingSettings\.templates\.editor\.view/)
  })
})

describe('editor model', () => {
  it('inserts a placeholder over the selection and puts the cursor after it', () => {
    expect(insertPlaceholder('Hi , see you', 3, 3, 'name')).toEqual({ text: 'Hi {{name}}, see you', cursor: 11 })
    expect(insertPlaceholder('Hi XX!', 3, 5, 'name')).toEqual({ text: 'Hi {{name}}!', cursor: 11 })
    expect(insertPlaceholder('abc', 99, 99, 'date')).toEqual({ text: 'abc{{date}}', cursor: 11 })
  })

  // BOOK-002 F1 C6: what the editor opens with.
  it('opens with the custom text, else the approved live text, else the default', () => {
    expect(editorText(slot({ customBody: 'Custom {{date}} {{time}} ok.', approvedBody: 'Live {{date}} {{time}} ok.' }))).toBe('Custom {{date}} {{time}} ok.')
    expect(editorText(slot({ approvedBody: 'Live {{date}} {{time}} ok.' }))).toBe('Live {{date}} {{time}} ok.')
    expect(editorText(slot())).toBe('Default {{date}} at {{time}} ok.')
  })

  it('a reset still waiting for Meta opens with the default it submitted', () => {
    expect(editorText(slot({ approvedBody: 'Live {{date}} {{time}} ok.', candidate: { status: 'pending', reason: null } })))
      .toBe('Default {{date}} at {{time}} ok.')
  })

  it('previews the trimmed text with sample details', () => {
    expect(previewText('en', '  Hi {{name}} on {{date}}  ')).toBe('Hi Chan Tai Man on 2026-11-20')
    expect(previewText('en', 'Hi ｛｛name｝｝ on {{date}}')).toBe('Hi Chan Tai Man on 2026-11-20')
  })

  it('reads a save response into an outcome and the refreshed overview', () => {
    const pending = slots({ en: { candidate: { status: 'pending', reason: null } } })
    const at = { kind: 'confirmed' as const, language: 'en' as const, reset: false }
    expect(templateEditResult(200, { templates: statuses, slots: pending }, at)).toEqual({
      outcome: { kind: 'submitted' }, overview: { templates: statuses, slots: pending },
    })
    expect(templateEditResult(200, { templates: statuses, slots: slots() }, at).outcome).toEqual({ kind: 'already_live' })
    expect(templateEditResult(200, { templates: statuses, slots: slots({ en: { candidate: { status: 'failed', reason: null } } }) }, at).outcome)
      .toEqual({ kind: 'not_sent' })
    // F1 C4: rejected at submission → Meta's reason, not "save again".
    expect(templateEditResult(200, { templates: statuses, slots: slots({ en: { candidate: { status: 'rejected', reason: 'INVALID_FORMAT' } } }) }, at).outcome)
      .toEqual({ kind: 'rejected', reason: 'INVALID_FORMAT' })
    expect(templateEditResult(200, { templates: statuses, slots: pending }, { ...at, reset: true }).outcome).toEqual({ kind: 'reset' })
    expect(templateEditResult(400, { errors: [{ code: 'link' }] }, at).outcome).toEqual({ kind: 'invalid', errors: [{ code: 'link' }] })
    expect(templateEditResult(403, {}, at).outcome).toEqual({ kind: 'forbidden' })
    expect(templateEditResult(409, {}, at).outcome).toEqual({ kind: 'not_simple' })
    expect(templateEditResult(500, null, at).outcome).toEqual({ kind: 'error' })
    expect(templateEditResult(200, { templates: statuses, slots: { bogus: 1 } }, at).outcome).toEqual({ kind: 'error' })
  })

  it('the GET summary carries the editor access; a malformed one is null', () => {
    const s = slots()
    expect(parseBookingSettingsSummary({ mode: 'simple', externalUrl: null, templateEditor: { canEdit: true, slots: s } })?.editor)
      .toEqual({ canEdit: true, slots: s })
    expect(parseBookingSettingsSummary({ mode: 'simple', externalUrl: null, templateEditor: { canEdit: 'yes', slots: s } })?.editor?.canEdit)
      .toBe(false)
    expect(parseBookingSettingsSummary({ mode: 'simple', externalUrl: null, templateEditor: { slots: {} } })?.editor).toBeNull()
  })
})
