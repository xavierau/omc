import type { Referrer, ReferrerStatus } from '@/domain/entities/referrer'

export interface ReferrerRow {
  id: string
  name: string
  contact_email: string
  contact_phone: string | null
  commission_per_message_hkd: number
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
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export interface CreateReferrerInput {
  name: string
  contactEmail: string
  contactPhone?: string
  commissionPerMessageHkd?: number
}

export function mapReferrerToInsert(
  input: CreateReferrerInput
): Record<string, unknown> {
  const row: Record<string, unknown> = {
    name: input.name,
    contact_email: input.contactEmail,
  }
  if (input.contactPhone !== undefined) {
    row.contact_phone = input.contactPhone
  }
  if (input.commissionPerMessageHkd !== undefined) {
    row.commission_per_message_hkd = input.commissionPerMessageHkd
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
  if (input.contactPhone !== undefined) {
    row.contact_phone = input.contactPhone
  }
  if (input.commissionPerMessageHkd !== undefined) {
    row.commission_per_message_hkd = input.commissionPerMessageHkd
  }
  if (input.status !== undefined) row.status = input.status
  return row
}
