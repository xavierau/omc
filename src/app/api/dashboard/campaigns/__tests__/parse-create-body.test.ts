import { describe, it, expect } from 'vitest'
import { parseCreateBody, CampaignBodyError } from '../parse-create-body'

const RESTAURANT_ID = 'rest-1'

function baseBody(overrides: Record<string, unknown> = {}) {
  return { name: 'Promo', type: 'promo', templateEn: 'Hi {{name}}', ...overrides }
}

/** Parse and return the thrown CampaignBodyError (or fail the test). */
function parseErr(body: Record<string, unknown>): CampaignBodyError {
  try {
    parseCreateBody(body, RESTAURANT_ID)
  } catch (e) {
    if (e instanceof CampaignBodyError) return e
    throw e
  }
  throw new Error('expected parseCreateBody to throw')
}

describe('parseCreateBody — targetAudience "tag"', () => {
  it('parses targetAudience "tag" with a non-empty tagIds array', () => {
    const parsed = parseCreateBody(
      baseBody({ targetAudience: 'tag', tagIds: ['t-1', 't-2'] }),
      RESTAURANT_ID
    )
    expect(parsed.targetAudience).toBe('tag')
    expect(parsed.tagIds).toEqual(['t-1', 't-2'])
    // Member selection is unused for tag targeting.
    expect(parsed.memberIds).toEqual([])
  })

  it('rejects targetAudience "tag" with an empty tagIds array (400)', () => {
    const err = parseErr(baseBody({ targetAudience: 'tag', tagIds: [] }))
    expect(err.statusCode).toBe(400)
  })

  it('rejects targetAudience "tag" with a missing tagIds field (400)', () => {
    const err = parseErr(baseBody({ targetAudience: 'tag' }))
    expect(err.statusCode).toBe(400)
  })

  it('rejects targetAudience "tag" when a tag id is whitespace-only (400)', () => {
    const err = parseErr(baseBody({ targetAudience: 'tag', tagIds: ['  '] }))
    expect(err.statusCode).toBe(400)
  })

  it('rejects targetAudience "tag" when a tag id is not a string (400)', () => {
    const err = parseErr(baseBody({ targetAudience: 'tag', tagIds: [123] }))
    expect(err.statusCode).toBe(400)
  })
})

describe('parseCreateBody — tagIds default for non-tag audiences', () => {
  it('defaults tagIds to [] for targetAudience "all"', () => {
    const parsed = parseCreateBody(baseBody(), RESTAURANT_ID)
    expect(parsed.targetAudience).toBe('all')
    expect(parsed.tagIds).toEqual([])
  })

  it('defaults tagIds to [] for targetAudience "selected"', () => {
    const parsed = parseCreateBody(
      baseBody({ targetAudience: 'selected', memberIds: ['m-1'] }),
      RESTAURANT_ID
    )
    expect(parsed.targetAudience).toBe('selected')
    expect(parsed.memberIds).toEqual(['m-1'])
    expect(parsed.tagIds).toEqual([])
  })
})
