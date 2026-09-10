// #161 (CAMP-012): migration 078 duplicates the starter/growth/pro quota
// numbers in SQL (`plan_monthly_send_limit`) so the trigger + backfill can
// run without a round trip to the app. A silent drift between that CASE and
// `planCampaignQuota` (the TS source of truth, tenant-plan.ts) would mean
// a brand-new restaurant gets seeded with the wrong quota forever -- this
// test parses the migration SQL statically so drift fails HERE, not on a
// scratch DB run months later. Also asserts the trigger/backfill shape
// (AFTER INSERT, ON CONFLICT DO NOTHING x2, backfill SELECT) and that the
// trigger's INSERT column list is a real subset of the table's columns
// (mirrors integration-schema-contract.test.ts's D2 technique).
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect, beforeAll } from 'vitest'
import { planCampaignQuota, type TenantPlan } from '@/domain/value-objects/tenant-plan'
import { columnsForTable } from './schema-contract/parse-schema'

const MIGRATIONS_DIR = path.join(process.cwd(), 'supabase', 'migrations')

function readMigration(prefix: string): string {
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.startsWith(prefix) && f.endsWith('.sql'))
  if (files.length !== 1) {
    throw new Error(
      `expected exactly one migration file starting with "${prefix}", found ${files.length}: ${files.join(', ')}`
    )
  }
  return fs.readFileSync(path.join(MIGRATIONS_DIR, files[0]), 'utf8')
}

/** Extracts the CASE p_plan ... END body of plan_monthly_send_limit only --
 * scoped so a future unrelated CASE elsewhere in the file can't be picked
 * up by accident. */
function extractPlanCaseBody(sql: string): string {
  const fnMatch = /plan_monthly_send_limit[\s\S]*?CASE\s+p_plan([\s\S]*?)END/i.exec(sql)
  if (!fnMatch) {
    throw new Error('plan_monthly_send_limit CASE p_plan ... END body not found in migration 078')
  }
  return fnMatch[1]
}

describe('#161 migration 078 <-> planCampaignQuota parity (A8)', () => {
  let caseMap: Map<string, number>
  let elseValue: number | null

  beforeAll(() => {
    const sql = readMigration('078_')
    const body = extractPlanCaseBody(sql)
    caseMap = new Map()
    for (const m of body.matchAll(/WHEN\s+'(\w+)'\s+THEN\s+(\d+)/gi)) {
      caseMap.set(m[1], Number(m[2]))
    }
    const elseMatch = /ELSE\s+(\d+)/i.exec(body)
    elseValue = elseMatch ? Number(elseMatch[1]) : null
  })

  it.each<TenantPlan>(['starter', 'growth', 'pro'])(
    'maps "%s" to the same number as planCampaignQuota',
    (plan) => {
      expect(caseMap.get(plan)).toBe(planCampaignQuota(plan))
    }
  )

  it('has no extra plan keys beyond starter/growth/pro', () => {
    expect([...caseMap.keys()].sort()).toEqual(['growth', 'pro', 'starter'])
  })

  it('the ELSE branch matches the starter quota (unknown plan degrades safely)', () => {
    expect(elseValue).toBe(planCampaignQuota('starter'))
  })
})

describe('#161 migration 078 trigger + backfill shape (A9)', () => {
  let sql: string

  beforeAll(() => {
    sql = readMigration('078_')
  })

  it('creates an AFTER INSERT trigger on restaurants', () => {
    expect(sql).toMatch(/AFTER INSERT ON restaurants/i)
  })

  it('guards both the trigger insert and the backfill insert with ON CONFLICT (restaurant_id) DO NOTHING', () => {
    const matches = sql.match(/ON CONFLICT\s*\(restaurant_id\)\s*DO NOTHING/gi) ?? []
    expect(matches.length).toBe(2)
  })

  it('backfills tenant_campaign_settings from a SELECT over restaurants', () => {
    expect(sql).toMatch(/INSERT INTO tenant_campaign_settings[\s\S]*?SELECT[\s\S]*?FROM restaurants/i)
  })

  it("the trigger's INSERT column list is a subset of tenant_campaign_settings's real columns", () => {
    const insertMatch = /INSERT INTO tenant_campaign_settings\s*\(([^)]+)\)/i.exec(sql)
    if (!insertMatch) throw new Error('no INSERT INTO tenant_campaign_settings(...) found')
    const insertedColumns = insertMatch[1].split(',').map((c) => c.trim())
    const realColumns = columnsForTable('tenant_campaign_settings')
    const unknown = insertedColumns.filter((c) => !realColumns.has(c))
    expect(unknown, `unknown column(s): ${unknown.join(', ')}`).toEqual([])
  })
})
