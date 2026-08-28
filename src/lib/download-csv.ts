/**
 * WONB-019 B1 — shared Blob + `<a download>` CSV download, extracted from the
 * third occurrence of this pattern (commit-rejections-list.tsx,
 * admin/billing/csv-export.ts). The two existing copies are intentionally
 * left in place (Surgical Changes) — see plan AD-4.
 */
export function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
