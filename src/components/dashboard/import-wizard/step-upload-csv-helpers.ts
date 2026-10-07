/**
 * Pure classification of a `ParseCsvResult` into an upload-step outcome.
 * Split out of `step-upload-csv.tsx` so the shared row cap (`MAX_ROWS`) has
 * one definition and the branching is unit-testable without React.
 */

import type { ParseCsvResult } from './parse-csv'

export const MAX_ROWS = 50_000

export type UploadOutcome =
  | { kind: 'error'; error: 'empty' | 'tooManyRows' }
  | { kind: 'ok'; result: ParseCsvResult }

/** !phoneHeaderFound → empty · rows=[] && rejected=[] (header-only) → empty ·
 *  rows.length > maxRows → tooManyRows (accepted rows only, as today) · else ok. */
export function classifyParseResult(result: ParseCsvResult, maxRows: number): UploadOutcome {
  if (!result.phoneHeaderFound) return { kind: 'error', error: 'empty' }
  if (result.rows.length === 0 && result.rejected.length === 0) return { kind: 'error', error: 'empty' }
  if (result.rows.length > maxRows) return { kind: 'error', error: 'tooManyRows' }
  return { kind: 'ok', result }
}
