import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  IMPORT_TEMPLATE_CSV,
  IMPORT_TEMPLATE_FILENAME,
  downloadImportTemplate,
} from '@/components/dashboard/import-wizard/import-template'
import { parseCsv } from '@/components/dashboard/import-wizard/parse-csv'

vi.mock('@/lib/download-csv', () => ({ downloadCsv: vi.fn() }))

describe('IMPORT_TEMPLATE_CSV — T-B1.2 shape', () => {
  it('starts with a BOM, uses CRLF, and the first line is the exact header', () => {
    expect(IMPORT_TEMPLATE_CSV.charCodeAt(0)).toBe(0xfeff)
    expect(IMPORT_TEMPLATE_CSV).toContain('\r\n')
    const withoutBom = IMPORT_TEMPLATE_CSV.slice(1)
    const firstLine = withoutBom.split('\r\n')[0]
    expect(firstLine).toBe('phone,name,preferred_language,tags')
  })
})

describe('IMPORT_TEMPLATE_CSV — T-B1.3 quoted comma row', () => {
  it('contains the quoted comma-name row verbatim', () => {
    expect(IMPORT_TEMPLATE_CSV).toContain('+85291234568,"Chan, Tai Man",zh_hk,VIP')
  })
})

describe('IMPORT_TEMPLATE_CSV — T-B1.4 round-trip', () => {
  it('parses back into exactly the four expected rows with no rejections', () => {
    const result = parseCsv(IMPORT_TEMPLATE_CSV)
    expect(result).toEqual({
      phoneHeaderFound: true,
      rejected: [],
      rows: [
        {
          phoneE164: '+85291234567',
          name: 'Chan Tai Man',
          preferredLanguage: 'zh_hk',
          tags: ['VIP', 'Lunch'],
          ignoredTagCount: 0,
        },
        {
          phoneE164: '+85291234568',
          name: 'Chan, Tai Man',
          preferredLanguage: 'zh_hk',
          tags: ['VIP'],
          ignoredTagCount: 0,
        },
        {
          phoneE164: '+85291234569',
          name: '陳大文',
          preferredLanguage: 'zh_hk',
          tags: [],
          ignoredTagCount: 0,
        },
        {
          phoneE164: '+85291234570',
          name: 'Jane Doe',
          preferredLanguage: 'en',
          tags: ['Dinner'],
          ignoredTagCount: 0,
        },
      ],
    })
  })
})

describe('downloadImportTemplate — T-B1.5', () => {
  afterEach(() => vi.clearAllMocks())

  it('calls downloadCsv with the template content and filename', async () => {
    const { downloadCsv } = await import('@/lib/download-csv')
    downloadImportTemplate()
    expect(downloadCsv).toHaveBeenCalledWith(IMPORT_TEMPLATE_CSV, IMPORT_TEMPLATE_FILENAME)
  })

  it('the filename constant is import-template.csv', () => {
    expect(IMPORT_TEMPLATE_FILENAME).toBe('import-template.csv')
  })
})

describe('IMPORT_TEMPLATE_CSV — T-B1.6 readable in any editor', () => {
  it('has no line longer than 80 chars and no tab characters', () => {
    expect(IMPORT_TEMPLATE_CSV).not.toContain('\t')
    const lines = IMPORT_TEMPLATE_CSV.slice(1).split('\r\n')
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(80)
  })
})
