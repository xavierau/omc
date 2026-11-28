import { chromium } from 'playwright-core'
import fs from 'node:fs'
const S = '/private/tmp/claude-501/-Users-xavierau-Code-js-whatsapp-crm/0667e693-3225-4e9c-92e7-d789b1112048/scratchpad/c16'
const login = Object.fromEntries(fs.readFileSync(`${S}/login.env`, 'utf8').trim().split('\n').map((l) => l.split('=')))
const [EMAIL, PW] = login.STAFF.split('|')
const log = (...a) => { const l = `[${new Date().toISOString()}] [staff] ${a.join(' ')}`; console.log(l); fs.appendFileSync(`${S}/walk.log`, l + '\n') }
const b = await chromium.launch(); const page = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
await page.goto('http://localhost:3040/login'); await page.locator('#email').fill(EMAIL); await page.locator('#password').fill(PW)
await page.locator('form button[type="submit"]').click(); await page.waitForURL(/\/dashboard/)
await page.locator('a[href="/dashboard/setup"]').first().click(); await page.waitForURL(/\/setup\/profile$/)
log('staff sub-nav bookings visible =', await page.getByTestId('settings-nav-bookings').count() > 0)
const res = await page.goto('http://localhost:3040/dashboard/setup/bookings'); log('staff GET /dashboard/setup/bookings →', res.status())
await page.goto('http://localhost:3040/dashboard/setup/campaigns'); await page.getByTestId('settings-campaigns-quality-bar').waitFor()
log('staff skip toggle disabled =', await page.getByTestId('settings-campaigns-skip-toggle').isDisabled(), '; save button count =', await page.getByTestId('settings-campaigns-save').count(), '; thresholds chevron (details) count =', await page.getByTestId('settings-campaigns-thresholds').locator('details').count())
const put = await page.evaluate(async () => (await fetch('/api/dashboard/settings/campaigns', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ skipContactQuality: 'off', lapsedAfterDays: 9 }) })).status)
log('staff PUT /api/dashboard/settings/campaigns →', put)
await page.screenshot({ path: `${S}/shots/zh-HK-staff-settings-campaigns-1440.png`, fullPage: true })
await b.close()
