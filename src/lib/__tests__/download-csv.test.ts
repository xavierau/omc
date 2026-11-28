import { describe, it, expect, vi, afterEach } from 'vitest'
import { downloadCsv } from '@/lib/download-csv'

describe('downloadCsv — T-B1.1', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('creates a text/csv Blob object URL, clicks a download link named filename, and revokes the URL', async () => {
    const clickSpy = vi.fn()
    const anchor = { href: '', download: '', click: clickSpy }
    vi.stubGlobal('document', { createElement: vi.fn().mockReturnValue(anchor) })
    const createObjectURL = vi.fn().mockReturnValue('blob:mock-url')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })

    downloadCsv('a,b\n1,2', 'rows.csv')

    expect(createObjectURL).toHaveBeenCalledTimes(1)
    const blob = createObjectURL.mock.calls[0][0] as Blob
    expect(blob.type).toBe('text/csv;charset=utf-8;')
    expect(await blob.text()).toBe('a,b\n1,2')
    expect(anchor.href).toBe('blob:mock-url')
    expect(anchor.download).toBe('rows.csv')
    expect(clickSpy).toHaveBeenCalled()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url')
  })
})
