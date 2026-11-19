// CAMP-016 browser walk against the local stack (next dev :3040). Usage: node walk.mjs <locale-tag>
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'

const S = '/private/tmp/claude-501/-Users-xavierau-Code-js-whatsapp-crm/0667e693-3225-4e9c-92e7-d789b1112048/scratchpad/c16'
const TAG = process.argv[2] ?? 'en'
const BASE = 'http://localhost:3040'
const AUDIT = fs.readFileSync(process.env.HOME + '/.claude/skills/ui-layout-audit/layout-audit.js', 'utf8')
const login = Object.fromEntries(fs.readFileSync(`${S}/login.env`, 'utf8').trim().split('\n').map((l) => l.split('=')))
const [EMAIL, PW] = login.ADMIN.split('|')
const env = Object.fromEntries(fs.readFileSync(`${S}/sb.env`, 'utf8').trim().split('\n').map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '')] }))
const log = (...a) => { const line = `[${new Date().toISOString()}] [${TAG}] ${a.join(' ')}`; console.log(line); fs.appendFileSync(`${S}/walk.log`, line + '\n') }
const sql = (q) => execFileSync('/opt/homebrew/bin/psql', [env.DB_URL, '-tAc', q], { encoding: 'utf8' }).trim()
const audits = []

async function checkpoint(page, name, opts = {}) {
  await page.waitForTimeout(400)
  const vp = page.viewportSize()
  const file = `${S}/shots/${TAG}-${name}-${vp.width}.png`
  await page.screenshot({ path: file, fullPage: opts.fullPage ?? true })
  const r = await page.evaluate(AUDIT)
  fs.writeFileSync(file.replace('.png', '.audit.json'), JSON.stringify(r, null, 1))
  audits.push({ name: `${name}-${vp.width}`, ...r.summary, blockingFindings: r.findings.filter((f) => f.sev === 'blocking').map((f) => `${f.check} ${f.el}`) })
  log(`checkpoint ${name}@${vp.width}: blocking=${r.summary.blocking} warning=${r.summary.warning} → ${file}`)
}

async function signIn(page) {
  await page.goto(`${BASE}/login`)
  await page.locator('#email').fill(EMAIL)
  await page.locator('#password').fill(PW)
  await page.locator('form button[type="submit"]').click()
  await page.waitForURL(/\/dashboard/, { timeout: 30000 })
  log('signed in as admin →', page.url())
}

const expectText = async (loc, re, what) => {
  const txt = (await loc.innerText()).replace(/\s+/g, ' ')
  if (!re.test(txt)) throw new Error(`${what}: got "${txt}"`)
  log(`ok ${what}: "${txt.slice(0, 160)}"`)
}

async function desktop(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  page.on('console', (m) => m.type() === 'error' && log('console error:', m.text().slice(0, 200)))
  await signIn(page)
  // Real nav: sidebar Settings → desktop goes to the first group.
  await page.locator('aside a[href="/dashboard/setup"], nav a[href="/dashboard/setup"]').first().click()
  await page.waitForURL(/\/dashboard\/setup\/profile$/, { timeout: 30000 })
  log('sidebar Settings →', page.url())
  for (const g of ['profile', 'messages', 'bookings', 'campaigns', 'welcome', 'receipts']) {
    if (!(await page.getByTestId(`settings-nav-${g}`).isVisible())) throw new Error(`nav ${g} missing`)
  }
  log('sub-nav shows 6 groups')
  await checkpoint(page, 'settings-profile', { fullPage: false })
  for (const g of ['messages', 'bookings', 'welcome', 'receipts']) {
    await page.getByTestId(`settings-nav-${g}`).click()
    await page.waitForURL(new RegExp(`/dashboard/setup/${g}$`))
    await page.waitForLoadState('networkidle')
    await checkpoint(page, `settings-${g}`, { fullPage: false })
  }
  await page.getByTestId('settings-nav-campaigns').click()
  await page.waitForURL(/\/dashboard\/setup\/campaigns$/)
  await page.getByTestId('settings-campaigns-quality-bar').waitFor()
  for (const k of ['green', 'yellow', 'red', 'nodata']) await expectText(page.getByTestId(`settings-campaigns-quality-legend-${k}`), /\d/, `legend ${k}`)
  await expectText(page.getByTestId('settings-campaigns-skip-impact'), /6/, 'impact at Red only')
  log('skip toggle aria-checked =', await page.getByTestId('settings-campaigns-skip-toggle').getAttribute('aria-checked'))
  await expectText(page.getByTestId('settings-campaigns-thresholds'), /90%.*60%.*90/, 'thresholds summary')
  await checkpoint(page, 'settings-campaigns')
  await page.getByTestId('settings-campaigns-skip-level-red-yellow').click()
  await expectText(page.getByTestId('settings-campaigns-skip-impact'), /16/, 'impact at Red and Yellow')
  await page.getByTestId('settings-campaigns-lapsed-days').fill('0')
  await page.getByTestId('settings-campaigns-lapsed-days-error').waitFor()
  log('lapsed 0 → error shown; save disabled =', await page.getByTestId('settings-campaigns-save').isDisabled())
  await checkpoint(page, 'settings-campaigns-lapsed-error', { fullPage: false })
  await page.getByTestId('settings-campaigns-lapsed-days').fill('45')
  await page.getByTestId('settings-campaigns-save').click()
  await page.getByTestId('settings-campaigns-saved').waitFor()
  log('saved; DB row =', sql(`select skip_contact_quality||'|'||lapsed_after_days from tenant_campaign_settings where restaurant_id='c0160000-0000-4000-8000-000000000016'`))
  await checkpoint(page, 'settings-campaigns-saved', { fullPage: false })
  // Restore the defaults through the UI (Red only, 30) for the campaign-form walk.
  await page.getByTestId('settings-campaigns-skip-level-red').click()
  await page.getByTestId('settings-campaigns-lapsed-days').fill('30')
  await page.getByTestId('settings-campaigns-save').click()
  await page.getByTestId('settings-campaigns-saved').waitFor()
  log('restored; DB row =', sql(`select skip_contact_quality||'|'||lapsed_after_days from tenant_campaign_settings where restaurant_id='c0160000-0000-4000-8000-000000000016'`))

  // Campaign form via the sidebar.
  await page.locator('a[href="/dashboard/campaigns"]').first().click()
  await page.waitForURL(/\/dashboard\/campaigns$/)
  await page.getByRole('button', { name: /create campaign|建立/i }).first().click()
  const sheet = page.locator('[data-slot="sheet-content"], [role="dialog"]').first()
  await sheet.waitFor()
  await page.getByTestId('campaign-audience-quality-toggle').waitFor()
  log('form defaults: quality toggle =', await page.getByTestId('campaign-audience-quality-toggle').getAttribute('aria-checked'),
    'lapsed toggle =', await page.getByTestId('campaign-audience-lapsed-toggle').getAttribute('aria-checked'),
    'lapsed days =', await page.getByTestId('campaign-audience-lapsed-days').inputValue())
  await sheet.locator('select').first().selectOption('promo')
  await sheet.locator('input[name="targetAudience"][value="tag"]').check()
  await sheet.getByRole('button', { name: 'VIP' }).click()
  await sheet.getByRole('button', { name: 'Lunch regulars' }).click()
  await page.getByTestId('campaign-audience-lapsed-toggle').click()
  await expectText(page.getByTestId('campaign-audience-quality-key'), /Skipped|略過/, 'colour key')
  await page.waitForTimeout(800)
  await expectText(page.getByTestId('campaign-audience-summary-will-receive'), /^\d+$/, 'will receive')
  const shown = Number(await page.getByTestId('campaign-audience-summary-will-receive').innerText())
  await sheet.locator('input[name="targetAudience"][value="tag"]').evaluate((el) => el.scrollIntoView({ block: 'start' }))
  await checkpoint(page, 'campaign-form-tags-lapsed', { fullPage: false })
  await page.getByTestId('campaign-audience-summary').scrollIntoViewIfNeeded()
  await checkpoint(page, 'campaign-form-summary', { fullPage: false })
  // Zero state: an empty tag only.
  await sheet.getByRole('button', { name: 'VIP' }).click()
  await sheet.getByRole('button', { name: 'Lunch regulars' }).click()
  await sheet.getByRole('button', { name: 'New tag (empty)' }).click()
  await page.getByTestId('campaign-audience-zero-warning').waitFor()
  await page.getByTestId('campaign-audience-zero-warning').scrollIntoViewIfNeeded()
  await checkpoint(page, 'campaign-form-zero', { fullPage: false })
  await sheet.getByRole('button', { name: 'New tag (empty)' }).click()
  await sheet.getByRole('button', { name: 'VIP' }).click()
  await sheet.getByRole('button', { name: 'Lunch regulars' }).click()
  await page.waitForTimeout(800)
  // Create it (inline text, scheduled so nothing sends).
  const name = `CAMP-016 walk ${TAG}`
  await sheet.locator('input').first().fill(name)
  await sheet.locator('textarea').first().fill('Hello from the CAMP-016 walk')
  await sheet.getByRole('button', { name: /^create$|^建立$/i }).click()
  await sheet.waitFor({ state: 'hidden', timeout: 20000 })
  const row = sql(`select id||'|'||target_audience||'|'||audience_skip_quality||'|'||coalesce(audience_lapsed_days::text,'null') from campaigns where name='${name}' order by created_at desc limit 1`)
  const [cid] = row.split('|')
  const sent = sql(`select count(*) from campaign_audience_members('c0160000-0000-4000-8000-000000000016','tag',(select array_agg(tag_id) from campaign_tags where campaign_id='${cid}'),null,null,(select audience_lapsed_days from campaigns where id='${cid}'),true,(select audience_skip_quality from campaigns where id='${cid}'),90,0.9,0.6)`)
  log(`created campaign row ${row}; form showed will_receive=${shown}; resolver on the stored snapshot returns ${sent} → parity ${String(shown) === sent ? 'OK' : 'MISMATCH'}`)

  // Members table: badge tooltip carries the colour meaning (D4).
  await page.locator('a[href="/dashboard/members"]').first().click()
  await page.waitForURL(/\/dashboard\/members$/)
  const badge = page.locator('[data-testid$="-quality"]').first()
  await badge.waitFor({ timeout: 20000 })
  log('members badge title:', JSON.stringify(await badge.getAttribute('title')))
  await ctx.close()
}

async function mobile(browser) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
  const page = await ctx.newPage()
  await signIn(page)
  await page.getByRole('button', { name: 'Toggle menu' }).click()
  await page.locator('a[href="/dashboard/setup"]').first().click()
  await page.waitForURL(/\/dashboard\/setup$/)
  await page.getByTestId('settings-index-row-campaigns').waitFor()
  await page.waitForTimeout(800)
  log('phone /dashboard/setup stays on the index:', page.url())
  await checkpoint(page, 'settings-index')
  await page.getByTestId('settings-index-row-campaigns').click()
  await page.waitForURL(/\/dashboard\/setup\/campaigns$/)
  await page.getByTestId('settings-back').waitFor()
  await page.getByTestId('settings-campaigns-quality-bar').waitFor()
  await checkpoint(page, 'settings-campaigns')
  await page.getByTestId('settings-back').click()
  await page.waitForURL(/\/dashboard\/setup$/)
  log('‹ Settings → back to index')
  await page.goto(`${BASE}/dashboard/campaigns`)
  await page.getByRole('button', { name: /create campaign|建立/i }).first().click()
  await page.getByTestId('campaign-audience-quality-toggle').waitFor()
  await page.locator('input[name="targetAudience"][value="tag"]').check()
  await page.getByRole('button', { name: 'VIP' }).click()
  await page.waitForTimeout(800)
  await page.getByTestId('campaign-audience-summary').scrollIntoViewIfNeeded()
  await checkpoint(page, 'campaign-form-summary', { fullPage: false })
  await ctx.close()
}

const browser = await chromium.launch()
try {
  if (process.argv[3] !== 'mobile-only') await desktop(browser)
  await mobile(browser)
} finally {
  fs.writeFileSync(`${S}/audit-summary-${TAG}.json`, JSON.stringify(audits, null, 1))
  await browser.close()
}
