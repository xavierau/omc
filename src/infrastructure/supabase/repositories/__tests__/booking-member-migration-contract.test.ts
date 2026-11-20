// BOOK-008: the TS tests cannot see migration 088's SQL, so this pins its
// shape; the AC-6 scratch-DB log (evidence/2026-11-20-book-008) proves its
// semantics on real Postgres.
// - R1 backfill: only member-less, non-unverified rows; same restaurant AND
//   phone; nothing inserted (no member, consent or opt-in row).
// - R2/R4 relink: one statement, the compare-and-set UPDATE and its events row.
// - R8 stats: scoped by restaurant AND member, unverified excluded.
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
      "SELECT p_restaurant_id, NULL, 'booking.member_relinked', p_actor_user_id, jsonb_build_object('bookingId', c.id, 'fromMemberId', p_from_member_id, 'toMemberId', p_to_member_id) FROM changed c"
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
    expect(src).toContain("count(*) FILTER (WHERE b.status = 'no_show')::int")
    expect(src).not.toMatch(/SECURITY DEFINER/i)
    expect(ALL).toContain('REVOKE ALL ON FUNCTION public.member_booking_stats(uuid, uuid, date, time) FROM PUBLIC, anon, authenticated;')
    expect(ALL).toContain('GRANT EXECUTE ON FUNCTION public.member_booking_stats(uuid, uuid, date, time) TO service_role;')
  })
})

describe('088 events_type_check', () => {
  it('equals the EventType union in src/domain/entities/event.ts', () => {
    const check = ALL.slice(ALL.indexOf('CHECK (type IN ('), ALL.indexOf('));', ALL.indexOf('CHECK (type IN (')))
    const inSql = [...check.matchAll(/'([^']+)'/g)].map((m) => m[1]).sort()
    const union = EVENT_TS.slice(EVENT_TS.indexOf('export type EventType'), EVENT_TS.indexOf('export interface CrmEvent'))
    const inTs = [...union.matchAll(/\| '([^']+)'/g)].map((m) => m[1]).sort()
    expect(inSql).toContain('booking.member_relinked')
    expect(inSql).toEqual(inTs)
    expect(inSql).toHaveLength(21)
  })
})
