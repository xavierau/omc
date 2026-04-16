import { describe, it, expect } from 'vitest'
import {
  mapRowToReferrer,
  mapReferrerToInsert,
  mapReferrerToUpdate,
  type ReferrerRow,
} from '../referrer-mapper'

function buildRow(overrides: Partial<ReferrerRow> = {}): ReferrerRow {
  return {
    id: 'ref-1',
    name: 'Acme Partner',
    contact_email: 'partner@acme.com',
    contact_phone: '+85212345678',
    commission_per_message_hkd: 0.05,
    status: 'active',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
    ...overrides,
  }
}

describe('mapRowToReferrer', () => {
  it('maps all fields from DB row to domain type', () => {
    const row = buildRow()
    const result = mapRowToReferrer(row)

    expect(result).toEqual({
      id: 'ref-1',
      name: 'Acme Partner',
      contactEmail: 'partner@acme.com',
      contactPhone: '+85212345678',
      commissionPerMessageHkd: 0.05,
      commissionPerRedemptionHkd: 0.10,
      status: 'active',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-02T00:00:00Z',
    })
  })

  it('maps null contact_phone to null', () => {
    const row = buildRow({ contact_phone: null })
    const result = mapRowToReferrer(row)

    expect(result.contactPhone).toBeNull()
  })
})

describe('mapReferrerToInsert', () => {
  it('maps required fields from camelCase to snake_case', () => {
    const result = mapReferrerToInsert({
      name: 'New Partner',
      contactEmail: 'new@partner.com',
    })

    expect(result).toEqual({
      name: 'New Partner',
      contact_email: 'new@partner.com',
    })
  })

  it('includes optional fields when provided', () => {
    const result = mapReferrerToInsert({
      name: 'New Partner',
      contactEmail: 'new@partner.com',
      contactPhone: '+85298765432',
      commissionPerMessageHkd: 0.08,
    })

    expect(result).toEqual({
      name: 'New Partner',
      contact_email: 'new@partner.com',
      contact_phone: '+85298765432',
      commission_per_message_hkd: 0.08,
    })
  })

  it('omits undefined optional fields', () => {
    const result = mapReferrerToInsert({
      name: 'Minimal',
      contactEmail: 'min@test.com',
    })

    expect(result).not.toHaveProperty('contact_phone')
    expect(result).not.toHaveProperty('commission_per_message_hkd')
  })
})

describe('mapReferrerToUpdate', () => {
  it('maps only provided fields', () => {
    const result = mapReferrerToUpdate({ name: 'Updated Name' })

    expect(result).toEqual({ name: 'Updated Name' })
  })

  it('includes status when provided', () => {
    const result = mapReferrerToUpdate({ status: 'inactive' })

    expect(result).toEqual({ status: 'inactive' })
  })

  it('omits undefined fields', () => {
    const result = mapReferrerToUpdate({
      contactEmail: 'updated@test.com',
    })

    expect(result).toEqual({ contact_email: 'updated@test.com' })
    expect(result).not.toHaveProperty('name')
    expect(result).not.toHaveProperty('contact_phone')
    expect(result).not.toHaveProperty('commission_per_message_hkd')
    expect(result).not.toHaveProperty('status')
  })
})
