/**
 * BOOK-001 W2 (R20): pure helpers for the booking-intent eval. The texts
 * stay in memory: nothing here writes or returns them beyond the classifier
 * call the CLI makes.
 */
import { INTENT_LABELS, type ClassifyResult, type IntentLabel } from '@/domain/ports/intent-classifier'

export interface LabelledRow {
  text: string
  label: IntentLabel
}

export interface Prediction {
  gold: IntentLabel
  result: ClassifyResult
}

export interface ThresholdMetrics {
  threshold: number
  tp: number
  fp: number
  fn: number
  precision: number
  recall: number
  f1: number
}

export const EVAL_THRESHOLDS = [0.5, 0.6, 0.7, 0.8, 0.9]

/** Minimal RFC 4180: quoted fields, doubled quotes, commas and newlines in quotes. */
export function parseCsv(source: string): string[][] {
  const rows: string[][] = [[]]
  let field = ''
  let quoted = false
  const endField = () => {
    rows[rows.length - 1].push(field)
    field = ''
  }
  for (let i = 0; i < source.length; i++) {
    const c = source[i]
    if (quoted && c === '"' && source[i + 1] === '"') {
      field += '"'
      i++
    } else if (c === '"') {
      quoted = !quoted
    } else if (quoted || (c !== ',' && c !== '\n' && c !== '\r')) {
      field += c
    } else if (c === ',') {
      endField()
    } else if (c === '\n' || source[i + 1] !== '\n') {
      endField()
      rows.push([])
    }
  }
  endField()
  return rows.filter((r) => r.some((f) => f.trim() !== ''))
}

/** Header must be `text,label`; every label must be one of the four options. */
export function parseLabelledCsv(source: string): LabelledRow[] {
  const [header, ...body] = parseCsv(source.replace(/^﻿/, ''))
  if (!header || header.map((h) => h.trim().toLowerCase()).join(',') !== 'text,label') {
    throw new Error('CSV header must be exactly: text,label')
  }
  return body.map((fields, i) => {
    const label = (fields[1] ?? '').trim() as IntentLabel
    if (!INTENT_LABELS.includes(label)) throw new Error(`row ${i + 2}: label must be one of ${INTENT_LABELS.join('/')}`)
    return { text: fields[0] ?? '', label }
  })
}

const isBookingAt = (result: ClassifyResult, t: number) => result.ok && result.label === 'booking' && result.confidence >= t
const ratio = (n: number, d: number) => (d === 0 ? 0 : n / d)

export function bookingMetrics(predictions: Prediction[], threshold: number): ThresholdMetrics {
  let tp = 0, fp = 0, fn = 0
  for (const { gold, result } of predictions) {
    const predicted = isBookingAt(result, threshold)
    if (predicted && gold === 'booking') tp++
    else if (predicted) fp++
    else if (gold === 'booking') fn++
  }
  const precision = ratio(tp, tp + fp)
  const recall = ratio(tp, tp + fn)
  return { threshold, tp, fp, fn, precision, recall, f1: ratio(2 * precision * recall, precision + recall) }
}

export type PredictedColumn = IntentLabel | 'error'

/** gold label → predicted label (raw, no threshold) → count. */
export function confusion(predictions: Prediction[]): Record<IntentLabel, Record<PredictedColumn, number>> {
  const columns: PredictedColumn[] = [...INTENT_LABELS, 'error']
  const empty = () => Object.fromEntries(columns.map((c) => [c, 0])) as Record<PredictedColumn, number>
  const table = Object.fromEntries(INTENT_LABELS.map((l) => [l, empty()])) as Record<IntentLabel, Record<PredictedColumn, number>>
  for (const { gold, result } of predictions) table[gold][result.ok ? result.label : 'error']++
  return table
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`.padStart(7)

export function formatReport(predictions: Prediction[]): string {
  const lines = [`rows: ${predictions.length}  errors: ${predictions.filter((p) => !p.result.ok).length}`, '']
  lines.push('threshold   tp   fp   fn  precision  recall      f1')
  for (const t of EVAL_THRESHOLDS) {
    const m = bookingMetrics(predictions, t)
    lines.push(`${t.toFixed(1).padStart(9)} ${String(m.tp).padStart(4)} ${String(m.fp).padStart(4)} ${String(m.fn).padStart(4)}    ${pct(m.precision)} ${pct(m.recall)} ${pct(m.f1)}`)
  }
  const table = confusion(predictions)
  const columns = [...INTENT_LABELS, 'error'] as const
  lines.push('', `gold \\ predicted  ${columns.map((c) => c.padStart(15)).join('')}`)
  for (const gold of INTENT_LABELS) {
    lines.push(`${gold.padEnd(17)}  ${columns.map((c) => String(table[gold][c]).padStart(15)).join('')}`)
  }
  return lines.join('\n')
}
