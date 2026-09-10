// INT-001 WI-5: structural guard for `loopback-test-guard.ts`'s own stated
// invariant -- "never imported from src/infrastructure or src/application"
// (see the file's top comment). Same grep-shaped-boundary pattern the repo
// already uses for `consent_records`' sole writer and (per the INT-001 plan,
// WI-7) `members`' sole insert site.

import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

describe('loopback-test-guard import boundary', () => {
  it('is never imported from PRODUCTION code under src/infrastructure or src/application (test files there are exempt)', () => {
    const roots = ['src/infrastructure', 'src/application']
    for (const root of roots) {
      let output = ''
      try {
        output = execFileSync(
          'grep',
          ['-rl', '--include=*.ts', '--include=*.tsx', 'loopback-test-guard', root],
          { cwd: process.cwd(), encoding: 'utf8' }
        )
      } catch (err) {
        // grep exits 1 when there are no matches -- that's the passing case.
        const status = (err as { status?: number }).status
        if (status !== 1) throw err
        output = ''
      }
      const hits = output
        .split('\n')
        .filter(Boolean)
        // Test files ARE allowed to import the test-only guard -- the
        // invariant this test enforces is that PRODUCTION code never does.
        .filter((file) => !/__tests__\//.test(file) && !/\.(test|spec)\.tsx?$/.test(file))
      expect(hits, `unexpected import of loopback-test-guard in ${root}: ${hits.join(', ')}`).toEqual([])
    }
  })
})
