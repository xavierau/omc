// WONB-004: import wizard step + URL helpers. Stream C made the preview
// API return per-row grades directly, so the placeholder
// `deriveRowsFromBreakdown` helper this file used to export was removed.

export type StepKey = 'meta' | 'csv' | 'grade' | 'confirm'
export const STEPS: StepKey[] = ['meta', 'csv', 'grade', 'confirm']

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

export function isStepKey(s: string | null): s is StepKey {
  return s !== null && (STEPS as string[]).includes(s)
}
