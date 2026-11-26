/**
 * BOOK-013 (spec UI states): a staff-made booking shows "By staff · <name>".
 * One lookup per distinct creator in the list (a handful of staff), never per row.
 */
import type { BookingRequest } from '@/domain/entities/booking-request'

export async function withCreatorNames(
  bookings: BookingRequest[],
  nameOf: (userId: string) => Promise<string | null>
): Promise<BookingRequest[]> {
  const ids = [...new Set(bookings.filter((b) => b.source === 'staff' && b.createdBy).map((b) => b.createdBy as string))]
  if (ids.length === 0) return bookings
  const names = new Map(await Promise.all(ids.map(async (id) => [id, await nameOf(id).catch(() => null)] as const)))
  return bookings.map((b) => (b.source === 'staff' && b.createdBy ? { ...b, createdByName: names.get(b.createdBy) ?? null } : b))
}
