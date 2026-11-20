// BOOK-007 r1 F1: a booking with an open (pending) change request must never
// be marked as a no-show, or confirming the change later leaves the original
// no_show and an undo resurrects a second confirmed booking. The mark is the
// RPC mark_booking_no_show (migration 087): ONE UPDATE whose WHERE carries the
// "no pending change in this restaurant" check, so no read-then-write race.
// The TS tests cannot see the SQL, so this pins its shape; AC-4 (scratch DB)
// proves its semantics on real Postgres.
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'

const SQL = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/087_booking_no_show.sql'), 'utf8')
const SIGNATURE = '(uuid, uuid, uuid, timestamptz, date, time)'
const squash = (s: string) => s.replace(/--.*$/gm, '').replace(/\s+/g, ' ').trim()

function fnSource(): string {
  const start = SQL.indexOf('CREATE OR REPLACE FUNCTION public.mark_booking_no_show(')
  expect(start, 'mark_booking_no_show is defined in 087').toBeGreaterThanOrEqual(0)
  const end = SQL.indexOf('$$ LANGUAGE', SQL.indexOf('$$', start) + 2)
  return squash(SQL.slice(start, SQL.indexOf(';', end) + 1))
}

describe('087 mark_booking_no_show (r1 F1)', () => {
  it('is a single SQL statement: one UPDATE, no separate read before it', () => {
    const src = fnSource()
    expect(src).toMatch(/\$\$ LANGUAGE sql;$/)
    expect(src.match(/\bUPDATE\b/g)).toHaveLength(1)
    const body = src.slice(src.indexOf('$$') + 2, src.lastIndexOf('$$'))
    expect(body.trim().startsWith('UPDATE booking_requests')).toBe(true)
    expect(body.split(';').filter((s) => s.trim() !== '')).toHaveLength(1)
  })

  it('moves only this restaurant\'s confirmed, past row, storing who and when', () => {
    const src = fnSource()
    expect(src).toContain("SET status = 'no_show', no_show_marked_by = p_marked_by, no_show_marked_at = p_marked_at")
    expect(src).toContain('WHERE b.id = p_id AND b.restaurant_id = p_restaurant_id')
    expect(src).toContain("AND b.status = 'confirmed'")
    expect(src).toContain('AND (b.booking_date < p_before_date OR (b.booking_date = p_before_date AND b.booking_time < p_before_time))')
  })

  it('refuses when a pending change request replaces it in the same restaurant, inside the same UPDATE', () => {
    expect(fnSource()).toContain(
      "AND NOT EXISTS ( SELECT 1 FROM booking_requests c WHERE c.replaces_booking_id = b.id AND c.restaurant_id = p_restaurant_id AND c.status = 'pending' )"
    )
  })

  it('returns the changed row, runs as the caller (no SECURITY DEFINER) and only service_role may execute it', () => {
    const src = fnSource()
    expect(src).toContain('RETURNS SETOF booking_requests')
    expect(src).toContain('RETURNING b.*')
    expect(src).not.toMatch(/SECURITY DEFINER/i)
    const all = squash(SQL)
    expect(all).toContain(`REVOKE ALL ON FUNCTION public.mark_booking_no_show${SIGNATURE} FROM PUBLIC, anon, authenticated;`)
    expect(all).toContain(`GRANT EXECUTE ON FUNCTION public.mark_booking_no_show${SIGNATURE} TO service_role;`)
  })
})
