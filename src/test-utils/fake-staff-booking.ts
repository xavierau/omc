// BOOK-013: in-memory staff booking + check-in store with the conditions of
// migration 095's RPCs (staff_create_booking, staff_update_booking,
// staff_cancel_booking, booking_check_in, booking_check_in_undo), written from
// the SQL, not from the use cases. `write` stands for any other writer and
// mirrors 095's edit_version trigger: the version moves only when status,
// slot, party, name, phone, notes or notify change; updated_at on every write. The SQL itself is proven on a scratch DB
// (.claude-workspace/artifacts/evidence/2026-11-26-book-013/scratch-db-095.log).
// 096 (decision 9): a null phone forces notify off; an update to a null phone
// matches only a source 'staff' row (scratch-db-096.log in the 2026-11-27 evidence).
import type { BookingRequest } from '@/domain/entities/booking-request'
import type {
  CheckInArgs,
  CheckinStore,
  StaffBookingStore,
  StaffCancelArgs,
  StaffCreateArgs,
  StaffUpdateArgs,
} from '@/domain/ports/staff-booking'

export type StaffRow = BookingRequest & {
  editVersion: number
  /** 082's trigger: every write. Never part of the staff conditional write (review R1). */
  updatedAt: string
  reminderSentAt?: string | null
  lastStaffMessageAt?: string | null
  cancelledByUser?: string | null
  checkedInBy?: string | null
}

export interface StaffEvent {
  restaurantId: string
  type: string
  actor: string
  data: Record<string, unknown>
}

let tick = 0
/** A fresh updated_at per write (the 082 trigger), microsecond-shaped like PostgREST's. */
const stamp = () => `2026-11-26T00:00:${String(++tick % 60).padStart(2, '0')}.${String(tick).padStart(6, '0')}+00:00`

export function staffRow(extra: Partial<StaffRow> = {}): StaffRow {
  return {
    id: crypto.randomUUID(), restaurantId: 'rest-a', memberId: null, phone: '+85291234567', name: 'Chan Tai Man', partySize: 2,
    bookingDate: '2026-11-28', bookingTime: '19:00', notes: null, status: 'confirmed', declineReason: null, decidedBy: 'u',
    decidedAt: '2026-11-20T00:00:00Z', source: 'chat', campaignId: null, createdAt: '2026-11-20T00:00:00Z',
    decisionMessageStatus: 'delivered', replacesBookingId: null, cancelledBy: null, editVersion: 0, updatedAt: stamp(), createdBy: null,
    notifyDiner: true, checkedInAt: null, reminderSentAt: null, lastStaffMessageAt: null, ...extra,
  }
}

/** 095 bump_booking_edit_version: what staff edit or see. */
const VERSIONED = ['status', 'bookingDate', 'bookingTime', 'partySize', 'name', 'phone', 'notes', 'notifyDiner'] as const

/** Applies `patch` as one UPDATE: updated_at always (082), edit_version only on a versioned change (095). */
function apply(row: StaffRow, patch: Partial<StaffRow>): void {
  const moved = VERSIONED.some((k) => k in patch && patch[k] !== row[k])
  Object.assign(row, patch, { updatedAt: stamp(), editVersion: row.editVersion + (moved ? 1 : 0) })
}

export class FakeStaffBookings implements StaffBookingStore, CheckinStore {
  readonly rows: StaffRow[] = []
  readonly events: StaffEvent[] = []
  /** Every write the fake took, for "nothing written" assertions. */
  readonly writes: string[] = []

  private openChange(row: StaffRow): boolean {
    return this.rows.some((c) => c.replacesBookingId === row.id && c.restaurantId === row.restaurantId && c.status === 'pending')
  }

  private view(row: StaffRow): BookingRequest {
    const change = this.rows.find((c) => c.replacesBookingId === row.id && c.status === 'pending')
    return { ...row, ...(change ? { openChange: { id: change.id, bookingDate: change.bookingDate, bookingTime: change.bookingTime, partySize: change.partySize } } : {}) } as BookingRequest
  }

  private mine(id: string, restaurantId: string) {
    return this.rows.find((r) => r.id === id && r.restaurantId === restaurantId)
  }

  private audit(restaurantId: string, type: string, actor: string, data: Record<string, unknown>, broken: string[] = []) {
    this.events.push({ restaurantId, type, actor, data: broken.length > 0 ? { ...data, brokenRules: broken } : data })
  }

  /** Any other writer (reminder claim, message status, diner AI, another staff): one UPDATE through the triggers. */
  write(id: string, patch: Partial<StaffRow>): void {
    const row = this.rows.find((r) => r.id === id)
    if (!row) throw new Error(`no row ${id}`)
    apply(row, patch)
  }

  async find(id: string, restaurantId: string) {
    const row = this.mine(id, restaurantId)
    return row && row.status !== 'unverified' ? this.view(row) : null
  }

  async create(args: StaffCreateArgs) {
    this.writes.push('create')
    const { input } = args
    const row = staffRow({
      restaurantId: args.restaurantId, memberId: args.memberId, phone: input.phone, name: input.name, partySize: input.partySize,
      bookingDate: input.date, bookingTime: input.time, notes: input.notes, status: 'confirmed', source: 'staff',
      decidedBy: args.actorUserId, decidedAt: args.at.toISOString(), createdBy: args.actorUserId, notifyDiner: input.notify && input.phone !== null,
      decisionMessageStatus: null,
    })
    this.rows.push(row)
    this.audit(args.restaurantId, 'booking.staff_created', args.actorUserId, { bookingId: row.id }, args.brokenRules)
    return this.view(row)
  }

  async update(args: StaffUpdateArgs) {
    this.writes.push('update')
    const row = this.mine(args.id, args.restaurantId)
    if (!row || row.status !== args.expectedStatus || !['pending', 'confirmed'].includes(row.status)) return null
    if (row.editVersion !== args.expectedVersion || this.openChange(row)) return null
    const { input } = args
    if (input.phone === null && row.source !== 'staff') return null
    apply(row, {
      memberId: args.memberId, phone: input.phone, name: input.name, partySize: input.partySize, bookingDate: input.date,
      bookingTime: input.time, notes: input.notes, notifyDiner: input.notify && input.phone !== null,
      reminderSentAt: args.clearReminder ? null : row.reminderSentAt,
    })
    this.audit(args.restaurantId, 'booking.staff_edited', args.actorUserId, { bookingId: row.id, changed: args.changed }, args.brokenRules)
    return this.view(row)
  }

  async cancel(args: StaffCancelArgs) {
    this.writes.push('cancel')
    const row = this.mine(args.id, args.restaurantId)
    if (!row || row.status !== 'confirmed' || row.editVersion !== args.expectedVersion || this.openChange(row)) return null
    apply(row, { status: 'cancelled', cancelledBy: 'staff', cancelledByUser: args.actorUserId })
    this.audit(args.restaurantId, 'booking.staff_cancelled', args.actorUserId, { bookingId: row.id })
    return this.view(row)
  }

  async claimStaffMessage(id: string, restaurantId: string, at: Date, gapMs: number) {
    const row = this.mine(id, restaurantId)
    if (!row) return false
    if (row.lastStaffMessageAt && Date.parse(row.lastStaffMessageAt) >= at.getTime() - gapMs) return false
    apply(row, { lastStaffMessageAt: at.toISOString() })
    return true
  }

  async listForDate(restaurantId: string, date: string, cap: number) {
    const rows = this.rows
      .filter((r) => r.restaurantId === restaurantId && r.bookingDate === date && ['pending', 'confirmed', 'no_show'].includes(r.status))
      .sort((a, b) => a.bookingTime.localeCompare(b.bookingTime))
    return { bookings: rows.slice(0, cap).map((r) => this.view(r)), truncated: rows.length > cap }
  }

  async checkIn(args: CheckInArgs) {
    this.writes.push('checkIn')
    const row = this.mine(args.id, args.restaurantId)
    if (!row || row.status !== 'confirmed' || row.bookingDate !== args.today || row.checkedInAt || this.openChange(row)) return null
    apply(row, { checkedInAt: args.at.toISOString(), checkedInBy: args.actorUserId })
    this.audit(args.restaurantId, 'booking.checked_in', args.actorUserId, { bookingId: row.id })
    return this.view(row)
  }

  async undoCheckIn(args: { id: string; restaurantId: string; actorUserId: string }) {
    this.writes.push('undoCheckIn')
    const row = this.mine(args.id, args.restaurantId)
    if (!row || !row.checkedInAt) return null
    apply(row, { checkedInAt: null, checkedInBy: null })
    this.audit(args.restaurantId, 'booking.check_in_undone', args.actorUserId, { bookingId: row.id })
    return this.view(row)
  }
}

