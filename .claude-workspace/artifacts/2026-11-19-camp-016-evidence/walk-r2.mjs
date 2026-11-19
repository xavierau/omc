// CAMP-016 r2: the campaign create sheet with a Tags audience shows one recipient number set.
// Usage: node walk-r2.mjs  (local stack + next dev :3040, seeded by seed.sh)
import { chromium } from 'playwright-core'
import fs from 'node:fs'

const S = '/private/tmp/claude-501/-Users-xavierau-Code-js-whatsapp-crm/0667e693-3225-4e9c-92e7-d789b1112048/scratchpad/c16'
const OUT = `${S}/shots-r2`
const BASE = 'http://localhost:3040'
const AUDIT = fs.readFileSync(process.env.HOME + '/.claude/skills/ui-layout-audit/layout-audit.js', 'utf8')
const login = Object.fromEntries(fs.readFileSync(`${S}/login.env`, 'utf8').trim().split('\n').map((l) => l.split('=')))
const [EMAIL, PW] = login.ADMIN.split('|')
fs.mkdirSync(OUT, { recursive: true })
const log = (...a) => { const line = `[${new Date().toISOString()}] ${a.join(' ')}`; console.log(line); fs.appendFileSync(`${OUT}/walk-r2.log`, line + '\n') }

async function checkpoint(page, name) {
  await page.waitForTimeout(400)
  const vp = page.viewportSize()
  const file = `${OUT}/en-${name}-${vp.width}.png`
  await page.screenshot({ path: file })
  const r = await page.evaluate(AUDIT)
  fs.writeFileSync(file.replace('.png', '.audit.json'), JSON.stringify(r, null, 1))
  log(`checkpoint ${name}@${vp.width}: blocking=${r.summary.blocking} warning=${r.summary.warning} → ${file}`)
  for (const f of r.findings.filter((x) => x.sev === 'blocking')) log(`  blocking: ${f.check} ${f.el}`)
}

async function assertOneNumber(page, sheet, label) {
  const legacy = await sheet.locator('[data-field="recipient-count"]').count()
  const legacyText = await sheet.getByText(/will receive this$/).count()
  const summary = await page.getByTestId('campaign-audience-summary').innerText()
  log(`${label}: legacy [data-field=recipient-count] count=${legacy}; "will receive this" lines=${legacyText}; summary="${summary.replace(/\s+/g, ' ')}"`)
  if (legacy !== 0 || legacyText !== 0) throw new Error(`${label}: legacy line still rendered`)
}

const browser = await chromium.launch()
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  page.on('console', (m) => m.type() === 'error' && log('console error:', m.text().slice(0, 200)))
  await page.goto(`${BASE}/login`)
  await page.locator('#email').fill(EMAIL)
  await page.locator('#password').fill(PW)
  await page.locator('form button[type="submit"]').click()
  await page.waitForURL(/\/dashboard/, { timeout: 60000 })
  log('signed in as admin →', page.url())
  await page.locator('a[href="/dashboard/campaigns"]').first().click()
  await page.waitForURL(/\/dashboard\/campaigns$/, { timeout: 60000 })
  await page.getByRole('button', { name: /create campaign/i }).first().click()
  const sheet = page.locator('[data-slot="sheet-content"], [role="dialog"]').first()
  await sheet.waitFor()
  await page.getByTestId('campaign-audience-quality-toggle').waitFor({ timeout: 60000 })
  await sheet.locator('select').first().selectOption('promo')
  await sheet.locator('input[name="targetAudience"][value="tag"]').check()
  await sheet.getByRole('button', { name: 'VIP' }).click()
  await sheet.getByRole('button', { name: 'Lunch regulars' }).click()
  await page.waitForTimeout(1500)
  const wr = await page.getByTestId('campaign-audience-summary-will-receive').innerText()
  log('will receive =', wr)
  await assertOneNumber(page, sheet, 'promo + tags')
  await sheet.locator('input[name="targetAudience"][value="tag"]').evaluate((el) => el.scrollIntoView({ block: 'start' }))
  await checkpoint(page, 'campaign-form-summary-r2')
  // Welcome keeps the legacy count (no summary renders there).
  await sheet.locator('select').first().selectOption('welcome')
  await page.waitForTimeout(1500)
  const welcomeLegacy = await sheet.locator('[data-field="recipient-count"]').count()
  const welcomeSummary = await page.getByTestId('campaign-audience-summary').count()
  log(`welcome + tags: legacy line count=${welcomeLegacy}; summary count=${welcomeSummary}`)
  await sheet.locator('input[name="targetAudience"][value="tag"]').evaluate((el) => el.scrollIntoView({ block: 'start' }))
  await checkpoint(page, 'campaign-form-welcome-r2')
  await ctx.close()
} finally {
  await browser.close()
}
