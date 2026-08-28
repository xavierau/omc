import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolveHeaderMedia } from '@/application/resolve-header-media'
import type { TemplateComponent } from '@/domain/entities/whatsapp-template'

vi.mock('@/infrastructure/kapso/template-media-upload', () => ({
  uploadHeaderMediaFromUrl: vi.fn(),
}))

import { uploadHeaderMediaFromUrl } from '@/infrastructure/kapso/template-media-upload'

const upload = uploadHeaderMediaFromUrl as unknown as ReturnType<typeof vi.fn>

const URL = 'https://cdn.example.com/h.jpg'
const PHONE = 'phone-1'

function imageHeader(handleOrUrl: string): TemplateComponent {
  return { type: 'HEADER', format: 'IMAGE', example: { header_handle: [handleOrUrl] } }
}

describe('resolveHeaderMedia', () => {
  beforeEach(() => upload.mockReset())

  it('leaves text-only components untouched and never calls the uploader', async () => {
    const components: TemplateComponent[] = [
      { type: 'HEADER', format: 'TEXT', text: 'Hi {{name}}' },
      { type: 'BODY', text: 'Body' },
    ]

    const result = await resolveHeaderMedia(components, PHONE)

    expect(result).toEqual({ ok: true, components })
    expect(upload).not.toHaveBeenCalled()
  })

  it('mints a handle for an image header whose value is a URL', async () => {
    upload.mockResolvedValueOnce({ ok: true, handle: '4:minted:handle' })
    const components = [imageHeader(URL), { type: 'BODY', text: 'B' } as TemplateComponent]

    const result = await resolveHeaderMedia(components, PHONE)

    expect(upload).toHaveBeenCalledWith(PHONE, URL)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect(result.components[0].example?.header_handle).toEqual(['4:minted:handle'])
    // body untouched
    expect(result.components[1]).toEqual({ type: 'BODY', text: 'B' })
  })

  it('mints from a camelCase headerHandle URL and drops the stale camel key', async () => {
    upload.mockResolvedValueOnce({ ok: true, handle: '4:minted:handle' })
    const components: TemplateComponent[] = [
      { type: 'HEADER', format: 'IMAGE', example: { headerHandle: [URL] } },
    ]

    const result = await resolveHeaderMedia(components, PHONE)

    expect(upload).toHaveBeenCalledWith(PHONE, URL)
    if (!result.ok) throw new Error('expected ok')
    // Minted handle lives under snake_case only — no stale camel URL survives.
    expect(result.components[0].example?.header_handle).toEqual(['4:minted:handle'])
    expect(result.components[0].example?.headerHandle).toBeUndefined()
  })

  it('leaves an image header that already carries a 4: handle and does not re-upload', async () => {
    const components = [imageHeader('4:already:handle')]

    const result = await resolveHeaderMedia(components, PHONE)

    expect(upload).not.toHaveBeenCalled()
    expect(result).toEqual({ ok: true, components })
  })

  it('propagates the uploader error and stops (no partial submit)', async () => {
    upload.mockResolvedValueOnce({ ok: false, handle: null, error: { title: 'not_configured' } })
    const components = [imageHeader(URL)]

    const result = await resolveHeaderMedia(components, PHONE)

    expect(result).toEqual({ ok: false, error: { title: 'not_configured' } })
  })

  it('surfaces an upload_failed error with its details', async () => {
    upload.mockResolvedValueOnce({ ok: false, handle: null, error: { title: 'upload_failed', details: 'boom' } })
    const components = [imageHeader(URL)]

    const result = await resolveHeaderMedia(components, PHONE)

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected not ok')
    expect(result.error).toEqual({ title: 'upload_failed', details: 'boom' })
  })
})
