/**
 * WONB-019 B1 — downloadable import template. Content is pinned by a
 * round-trip test (`parseCsv(IMPORT_TEMPLATE_CSV)` → exactly these rows,
 * `rejected: []`) so the template can never drift from the parser. BOM +
 * CRLF match the plan's Appendix B and the billing exporter precedent, so
 * Excel on Windows opens the Chinese example name correctly.
 */
import { downloadCsv } from '@/lib/download-csv'

const BOM = '﻿'
const LINES = [
  'phone,name,preferred_language,tags',
  '+85291234567,Chan Tai Man,zh_hk,VIP;Lunch',
  '+85291234568,"Chan, Tai Man",zh_hk,VIP',
  '+85291234569,陳大文,zh_hk,',
  '+85291234570,Jane Doe,en,Dinner',
]

export const IMPORT_TEMPLATE_FILENAME = 'import-template.csv'
export const IMPORT_TEMPLATE_CSV = BOM + LINES.join('\r\n') + '\r\n'

export function downloadImportTemplate(): void {
  downloadCsv(IMPORT_TEMPLATE_CSV, IMPORT_TEMPLATE_FILENAME)
}
