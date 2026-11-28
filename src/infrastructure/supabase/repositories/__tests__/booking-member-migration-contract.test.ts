// BOOK-008: the TS tests cannot see migration 088's SQL, so this pins its
// shape; the AC-6 scratch-DB log (evidence/2026-11-20-book-008) proves its
// semantics on real Postgres.
// - R1 backfill: only member-less, non-unverified rows; same restaurant AND
//   phone; nothing inserted (no member, consent or opt-in row).
// - R2/R4 relink: one statement, the compare-and-set UPDATE and its events row;
//   r1 F1: the booking's open change requests move in the same statement.
// - R8 stats: scoped by restaurant AND member, unverified excluded; r1 F2:
//   counts reservations, not rows.
// - r1 F3: a new member links the member-less bookings with its phone (R1).
// - events_type_check: 081's list plus the new type, equal to EventType.
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'

const SQL = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/088_booking_member_backfill.sql'), 'utf8')
const EVENT_TS = fs.readFileSync(path.join(process.cwd(), 'src/domain/entities/event.ts'), 'utf8')
const squash = (s: string) => s.replace(/--.*$/gm, '').replace(/\s+/g, ' ').trim()
const ALL = squash(SQL)

function fnSource(name: string): string {
  const start = SQL.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`)
  expect(start, `${name} is defined in 088`).toBeGreaterThanOrEqual(0)
  const end = SQL.indexOf('$$ LANGUAGE', SQL.indexOf('$$', start) + 2)
  return squash(SQL.slice(start, SQL.indexOf(';', end) + 1))
}

describe('088 backfill (R1)', () => {
  it('links member-less, non-unverified bookings to the same-restaurant member with the same phone, only', () => {
    expect(ALL).toContain(
      "UPDATE booking_requests b SET member_id = m.id FROM members m WHERE b.member_id IS NULL AND b.status <> 'unverified' AND m.restaurant_id = b.restaurant_id AND m.phone = b.phone;"
    )
  })

  it('inserts nothing but the relink audit row: no member, consent or opt-in rows', () => {
    const inserts = ALL.match(/INSERT INTO \w+/g) ?? []
    expect(inserts).toEqual(['INSERT INTO events'])
    expect(ALL).not.toMatch(/\b(members|consent_records)\s*\(/)
  })
})

describe('088 relink_booking_member (R2, R4)', () => {
  const SIGNATURE = '(uuid, uuid, uuid, uuid, uuid)'

  it('is one SQL statement: the scoped compare-and-set UPDATE, then its events row from the changed rows only', () => {
    const src = fnSource('relink_booking_member')
    expect(src).toMatch(/\$\$ LANGUAGE sql;$/)
    const body = src.slice(src.indexOf('$$') + 2, src.lastIndexOf('$$'))
    expect(body.split(';').filter((s) => s.trim() !== '')).toHaveLength(1)
    expect(src).toContain('WHERE b.id = p_id AND b.restaurant_id = p_restaurant_id')
    expect(src).toContain("AND b.status <> 'unverified'")
    expect(src).toContain('AND b.member_id IS NOT DISTINCT FROM p_from_member_id')
    expect(src).toContain('AND p_to_member_id IS DISTINCT FROM p_from_member_id')
    expect(src).toContain('SELECT 1 FROM members m WHERE m.id = p_to_member_id AND m.restaurant_id = p_restaurant_id')
    expect(src).toContain(
      "SELECT p_restaurant_id, NULL, 'booking.member_relinked', p_actor_user_id, jsonb_build_object('bookingId', c.id, 'fromMemberId', p_from_member_id, 'toMemberId', p_to_member_id) || CASE WHEN EXISTS (SELECT 1 FROM moved) THEN jsonb_build_object('changeIds', (SELECT jsonb_agg(m.id ORDER BY m.id) FROM moved m)) ELSE '{}'::jsonb END FROM changed c"
    )
  })

  it("r1 F1: moves the booking's OPEN change requests of this restaurant, only when the booking moved, with the same CAS", () => {
    const src = fnSource('relink_booking_member')
    expect(src).toContain(
      "moved AS ( UPDATE booking_requests c SET member_id = p_to_member_id FROM changed b WHERE c.replaces_booking_id = b.id AND c.restaurant_id = p_restaurant_id AND c.status = 'pending' AND c.member_id IS NOT DISTINCT FROM p_from_member_id RETURNING c.id )"
    )
  })

  it('runs as the caller and only service_role may execute it', () => {
    expect(fnSource('relink_booking_member')).not.toMatch(/SECURITY DEFINER/i)
    expect(ALL).toContain(`REVOKE ALL ON FUNCTION public.relink_booking_member${SIGNATURE} FROM PUBLIC, anon, authenticated;`)
    expect(ALL).toContain(`GRANT EXECUTE ON FUNCTION public.relink_booking_member${SIGNATURE} TO service_role;`)
  })
})

describe('088 member_booking_stats (R8)', () => {
  it('counts one member of one restaurant, unverified excluded; runs as the caller; service_role only', () => {
    const src = fnSource('member_booking_stats')
    expect(src).toContain("WHERE b.restaurant_id = p_restaurant_id AND b.member_id = p_member_id AND b.status <> 'unverified'")
    expect(src).toContain("count(*) FILTER (WHERE r.counted AND b.status = 'no_show')::int")
    expect(src).not.toMatch(/SECURITY DEFINER/i)
    expect(ALL).toContain('REVOKE ALL ON FUNCTION public.member_booking_stats(uuid, uuid, date, time) FROM PUBLIC, anon, authenticated;')
    expect(ALL).toContain('GRANT EXECUTE ON FUNCTION public.member_booking_stats(uuid, uuid, date, time) TO service_role;')
  })
})

describe('088 member_booking_stats counts reservations (r1 F2)', () => {
  const src = () => fnSource('member_booking_stats')

  it("a row counts unless it is an original cancelled by 'change' or a pending/declined change request", () => {
    expect(src()).toContain(
      "CROSS JOIN LATERAL ( SELECT b.cancelled_by IS DISTINCT FROM 'change' AND NOT (b.replaces_booking_id IS NOT NULL AND b.status IN ('pending', 'declined')) AS counted ) r"
    )
    for (const status of ['confirmed', 'cancelled', 'declined', 'no_show', 'pending']) {
      expect(src()).toContain(`count(*) FILTER (WHERE r.counted AND b.status = '${status}')::int`)
    }
    expect(src()).toContain('count(*) FILTER (WHERE r.counted)::int')
  })

  it('last = the latest past confirmed or no_show date; next is unchanged', () => {
    expect(src()).toContain(
      "max(b.booking_date) FILTER ( WHERE b.status IN ('confirmed', 'no_show') AND (b.booking_date < p_now_date OR (b.booking_date = p_now_date AND b.booking_time < p_now_time)) )"
    )
    expect(src()).toContain(
      "min(b.booking_date) FILTER ( WHERE b.status IN ('pending', 'confirmed') AND (b.booking_date > p_now_date OR (b.booking_date = p_now_date AND b.booking_time >= p_now_time)) )"
    )
  })
})

describe('088 member insert links its bookings (r1 F3, R1)', () => {
  it('an AFTER INSERT row trigger on members runs the link function', () => {
    expect(ALL).toContain('DROP TRIGGER IF EXISTS trg_members_link_bookings ON members;')
    expect(ALL).toContain(
      'CREATE TRIGGER trg_members_link_bookings AFTER INSERT ON members FOR EACH ROW EXECUTE FUNCTION public.link_member_bookings();'
    )
  })

  it("links only member-less, non-unverified bookings of the new member's restaurant and phone; runs as the caller", () => {
    const src = fnSource('link_member_bookings')
    expect(src).toContain(
      "UPDATE booking_requests b SET member_id = NEW.id WHERE b.member_id IS NULL AND b.status <> 'unverified' AND b.restaurant_id = NEW.restaurant_id AND b.phone = NEW.phone;"
    )
    expect(src).not.toMatch(/SECURITY DEFINER/i)
    expect(ALL).toContain('REVOKE ALL ON FUNCTION public.link_member_bookings() FROM PUBLIC, anon, authenticated;')
  })
})

/** The types one migration's events_type_check allows. */
function checkTypes(sql: string): string[] {
  const all = squash(sql)
  const at = all.indexOf('CHECK (type IN (', all.indexOf('events_type_check'))
  return [...all.slice(at, all.indexOf('));', at)).matchAll(/'([^']+)'/g)].map((m) => m[1]).sort()
}

describe('events_type_check', () => {
  const dir = path.join(process.cwd(), 'supabase/migrations')
  // The newest migration that rewrites the check is the one in force (BOOK-013: 095).
  const latest = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
    .filter((f) => /ADD CONSTRAINT events_type_check/.test(fs.readFileSync(path.join(dir, f), 'utf8'))).pop() as string

  it('088 adds booking.member_relinked to 081\'s list', () => {
    expect(checkTypes(SQL)).toContain('booking.member_relinked')
    expect(checkTypes(SQL)).toHaveLength(21)
  })

  it('the check in force equals the EventType union in src/domain/entities/event.ts and keeps every 088 type', () => {
    const inSql = checkTypes(fs.readFileSync(path.join(dir, latest), 'utf8'))
    const union = EVENT_TS.slice(EVENT_TS.indexOf('export type EventType'), EVENT_TS.indexOf('export interface CrmEvent'))
    const inTs = [...union.matchAll(/\| '([^']+)'/g)].map((m) => m[1]).sort()
    expect(latest).toBe('095_booking_staff_crud.sql')
    expect(inSql).toEqual(inTs)
    for (const t of checkTypes(SQL)) expect(inSql).toContain(t)
    expect(inSql).toHaveLength(26)
  })
})
