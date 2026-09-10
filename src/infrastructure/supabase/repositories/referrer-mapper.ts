import type { Referrer, ReferrerStatus } from '@/domain/entities/referrer'

export interface ReferrerRow {
  id: string
  name: string
  contact_email: string
  contact_phone: string | null
  commission_per_message_hkd: number
  commission_per_redemption_hkd: number
  status: ReferrerStatus
  created_at: string
  updated_at: string
}

export function mapRowToReferrer(row: ReferrerRow): Referrer {
  return {
    id: row.id,
    name: row.name,
    contactEmail: row.contact_email,
    contactPhone: row.contact_phone,
    commissionPerMessageHkd: row.commission_per_message_hkd,
    commissionPerRedemptionHkd: row.commission_per_redemption_hkd,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export interface CreateReferrerInput {
  name: string
  contactEmail: string
  contactPhone?: string | null
  commissionPerMessageHkd?: number | null
  commissionPerRedemptionHkd?: number | null
}

// Treat both undefined and null as "field not provided" for numeric rate
// fields — callers may pass null when the UI left the input blank. Omitting
// the column from the insert payload lets the DB default apply (e.g. 0.05 for
// commission_per_message_hkd, 0.10 for commission_per_redemption_hkd).
function isProvided<T>(value: T | null | undefined): value is T {
  return value !== undefined && value !== null
}

export function mapReferrerToInsert(
  input: CreateReferrerInput
): Record<string, unknown> {
  const row: Record<string, unknown> = {
    name: input.name,
    contact_email: input.contactEmail,
  }
  if (isProvided(input.contactPhone)) {
    row.contact_phone = input.contactPhone
  }
  if (isProvided(input.commissionPerMessageHkd)) {
    row.commission_per_message_hkd = input.commissionPerMessageHkd
  }
  if (isProvided(input.commissionPerRedemptionHkd)) {
    row.commission_per_redemption_hkd = input.commissionPerRedemptionHkd
  }
  return row
}

type UpdateInput = Partial<CreateReferrerInput> & {
  status?: ReferrerStatus
}

export function mapReferrerToUpdate(
  input: UpdateInput
): Record<string, unknown> {
  const row: Record<string, unknown> = {}
  if (input.name !== undefined) row.name = input.name
  if (input.contactEmail !== undefined) {
    row.contact_email = input.contactEmail
  }
  // contact_phone: pass through null explicitly (admin may want to clear it)
  if (input.contactPhone !== undefined) {
    row.contact_phone = input.contactPhone
  }
  // Commission rates: treat null same as undefined (omit → keep existing value).
  // Rates must be non-null in the DB (NOT NULL), so null is never a valid
  // update payload — drop it to avoid sending a DB-rejected value.
  if (isProvided(input.commissionPerMessageHkd)) {
    row.commission_per_message_hkd = input.commissionPerMessageHkd
  }
  if (isProvided(input.commissionPerRedemptionHkd)) {
    row.commission_per_redemption_hkd = input.commissionPerRedemptionHkd
  }
  if (input.status !== undefined) row.status = input.status
  return row
}
