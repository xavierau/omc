// INT-001 T-H6 / WI-7: `member-create-repository.ts` (the seam's own
// repository, `createOrGetMember` -> `insertMember`) must be the ONLY
// `.from('members').insert(` in `src/`. Before this work item there were
// FOUR independent insert sites (register-member.ts, register-member-web.ts,
// import-contacts-batch-row-member.ts, import-members-with-consent.ts) plus
// this one -- a caller written next month could silently create a member
// with no `member.created` fan-out and no error anywhere (threat T-H6).
//
// Same grep-shaped-boundary pattern the repo already uses for
// `loopback-test-guard`'s own import boundary
// (src/test-utils/__tests__/loopback-test-guard-boundary.test.ts) and for
// `consent_records`' sole writer.
//
// A "hit" is a `.from('members')` call (not inside a `//` comment) followed,
// on the same line or within the next 3 lines, by `.insert(` that is also
// not inside a `//` comment. Test files are exempt (mocks legitimately
// construct fake `.from('members').insert(...)` chains).

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function isCommentLine(line: string): boolean {
  return /^\s*\/\//.test(line)
}

function findMembersInsertHits(file: string): string[] {
  const lines = readFileSync(file, 'utf8').split('\n')
  const hits: string[] = []
  lines.forEach((line, idx) => {
    if (isCommentLine(line)) return
    if (!line.includes("from('members')")) return
    const window = lines
      .slice(idx, idx + 4)
      .filter((windowLine) => !isCommentLine(windowLine))
      .join('\n')
    if (window.includes('.insert(')) {
      hits.push(`${file}:${idx + 1}`)
    }
  })
  return hits
}

describe('members table insert boundary (INT-001 T-H6)', () => {
  it('has exactly one `.from(\'members\')` -> `.insert(` site in all of src/, in member-create-repository.ts', () => {
    let output = ''
    try {
      output = execFileSync(
        'grep',
        ['-rl', '--include=*.ts', '--include=*.tsx', "from('members')", 'src'],
        { cwd: process.cwd(), encoding: 'utf8' }
      )
    } catch (err) {
      // grep exits 1 when there are no matches at all -- that's fine, we
      // just have zero candidate files.
      const status = (err as { status?: number }).status
      if (status !== 1) throw err
      output = ''
    }

    const candidateFiles = output
      .split('\n')
      .filter(Boolean)
      .filter((file) => !/__tests__\//.test(file) && !/\.(test|spec)\.tsx?$/.test(file))

    const hits = candidateFiles.flatMap((file) => findMembersInsertHits(file))

    expect(hits, `expected exactly one members-insert site, found: ${hits.join(', ')}`).toHaveLength(1)
    expect(hits[0]).toMatch(
      /^src\/infrastructure\/supabase\/repositories\/member-create-repository\.ts:\d+$/
    )
  })
})
