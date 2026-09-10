import { describe, it, expect } from 'vitest'
import { buildMembersQuery } from '@/hooks/use-members'

describe('buildMembersQuery', () => {
  it('always includes page, sortBy and sortOrder', () => {
    const p = new URLSearchParams(
      buildMembersQuery({ page: 2, sortBy: 'name', sortOrder: 'asc' })
    )
    expect(p.get('page')).toBe('2')
    expect(p.get('sortBy')).toBe('name')
    expect(p.get('sortOrder')).toBe('asc')
  })

  it('omits search and tagId when they are absent', () => {
    const p = new URLSearchParams(
      buildMembersQuery({ page: 1, sortBy: 'x', sortOrder: 'desc' })
    )
    expect(p.has('search')).toBe(false)
    expect(p.has('tagId')).toBe(false)
  })

  it('includes search when provided', () => {
    const p = new URLSearchParams(
      buildMembersQuery({ page: 1, sortBy: 'x', sortOrder: 'desc', search: 'wong' })
    )
    expect(p.get('search')).toBe('wong')
  })

  it('threads tagId into the query when provided', () => {
    const p = new URLSearchParams(
      buildMembersQuery({ page: 1, sortBy: 'x', sortOrder: 'desc', tagId: 'tag-1' })
    )
    expect(p.get('tagId')).toBe('tag-1')
  })
})
