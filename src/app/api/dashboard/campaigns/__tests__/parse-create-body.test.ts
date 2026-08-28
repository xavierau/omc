import { describe, it, expect } from 'vitest'
import { parseCreateBody, CampaignBodyError } from '../parse-create-body'
import { MAX_TAG_IDS } from '../parse-create-body-audience'

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

const TAG_A = '11111111-1111-4111-8111-111111111111'
const TAG_B = '22222222-2222-4222-8222-222222222222'

function uuidAt(index: number): string {
  return `33333333-3333-4333-8333-${String(index).padStart(12, '0')}`
}

describe('parseCreateBody — targetAudience "tag"', () => {
  it('parses targetAudience "tag" with a non-empty tagIds array', () => {
    const parsed = parseCreateBody(
      baseBody({ targetAudience: 'tag', tagIds: [TAG_A, TAG_B] }),
      RESTAURANT_ID
    )
    expect(parsed.targetAudience).toBe('tag')
    expect(parsed.tagIds).toEqual([TAG_A, TAG_B])
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

  it('rejects targetAudience "tag" when tagIds is not an array (400)', () => {
    const err = parseErr(baseBody({ targetAudience: 'tag', tagIds: TAG_A }))
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

  // A non-UUID id reaches PostgREST as `invalid input syntax for type uuid`,
  // which the route's catch-all reports as a 500 for what is bad client input
  // (review round 2, finding 4 — M-8 parity).
  it('rejects a tag id that is not a UUID (400)', () => {
    const err = parseErr(baseBody({ targetAudience: 'tag', tagIds: ['not-a-uuid'] }))
    expect(err.statusCode).toBe(400)
  })

  it('dedupes repeated tag ids', () => {
    const parsed = parseCreateBody(
      baseBody({ targetAudience: 'tag', tagIds: [TAG_A, TAG_B, TAG_A] }),
      RESTAURANT_ID
    )
    expect(parsed.tagIds).toEqual([TAG_A, TAG_B])
  })

  it('accepts exactly MAX_TAG_IDS distinct tags', () => {
    const tagIds = Array.from({ length: MAX_TAG_IDS }, (_, i) => uuidAt(i))
    const parsed = parseCreateBody(
      baseBody({ targetAudience: 'tag', tagIds }),
      RESTAURANT_ID
    )
    expect(parsed.tagIds).toHaveLength(MAX_TAG_IDS)
  })

  it('rejects more than MAX_TAG_IDS distinct tags (400)', () => {
    const tagIds = Array.from({ length: MAX_TAG_IDS + 1 }, (_, i) => uuidAt(i))
    const err = parseErr(baseBody({ targetAudience: 'tag', tagIds }))
    expect(err.statusCode).toBe(400)
  })

  it('counts the cap AFTER dedup — duplicates do not consume the budget', () => {
    const tagIds = Array.from({ length: MAX_TAG_IDS + 20 }, (_, i) =>
      uuidAt(i % MAX_TAG_IDS)
    )
    const parsed = parseCreateBody(
      baseBody({ targetAudience: 'tag', tagIds }),
      RESTAURANT_ID
    )
    expect(parsed.tagIds).toHaveLength(MAX_TAG_IDS)
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
