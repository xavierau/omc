/**
 * ⚠️  THIS FILE IS RED BY DESIGN — it is the failing test for a QA-found gap.
 *
 * QA (acceptance) — Feedback State 1 of the frozen plan
 * (plans/2026-08-28-tag-001-issues-138-139, "Feedback States → 1. CSV upload"):
 *
 *   success: existing `csv.rowCount` + `csv.tagsFound` when any row carries a tag.
 *   warning: `csv.tagsIgnored` when values were dropped (blank, >40 chars, or
 *            over 10 per row).
 *
 * B0 added both keys to en.json and zh-HK.json, but no work item was ever
 * assigned the render side: `parseCsv` throws away the `ignored` count that
 * `normalizeImportTags` returns, and `StepUploadCsv` renders neither key. A
 * merchant whose CSV carries a 41-character tag, or 12 tags in one cell, gets
 * no signal at all that values were dropped — a silent rejection.
 *
 * Written by qa-engineer during acceptance verification. Do NOT commit this
 * file on its own: commit it together with the fix that makes it green, or
 * delete it if the gap is formally risk-accepted.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseCsv } from '@/components/dashboard/import-wizard/parse-csv'

const WIZARD_DIR = join(process.cwd(), 'src/components/dashboard/import-wizard')

describe('CSV upload step — tag feedback (Feedback State 1)', () => {
  it('surfaces how many tag values were dropped so the upload step can warn', () => {
    const overLong = 'x'.repeat(41)
    const rows = parseCsv(`phone,tags\n+85291234567,${overLong};vip\n`).rows

    // The surviving tag is kept correctly …
    expect(rows[0].tags).toEqual(['vip'])

    // … but the dropped-value count `normalizeImportTags` computes is
    // discarded inside parseCsv, so nothing downstream can render
    // `importWizard.csv.tagsIgnored`.
    expect(rows[0]).toHaveProperty('ignoredTagCount', 1)
  })

  it('renders csv.tagsFound / csv.tagsIgnored on the upload step', () => {
    const step = readFileSync(join(WIZARD_DIR, 'step-upload-csv.tsx'), 'utf-8')
    expect(step).toContain('csv.tagsFound')
    expect(step).toContain('csv.tagsIgnored')
  })
})
