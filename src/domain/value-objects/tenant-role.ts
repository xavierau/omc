/**
 * BOOK-013 (owner 2026-11-26): the tenant roles that may work the Bookings
 * page (confirm/decline, no-show, member link, capacity, staff create / edit /
 * cancel / check-in). `user_tenants.role` holds only these two (migration
 * 011); this is the one list every bookings route checks.
 */
export const STAFF_ROLES: readonly string[] = ['admin', 'staff']

export function isStaffRole(role: string): boolean {
  return STAFF_ROLES.includes(role)
}
