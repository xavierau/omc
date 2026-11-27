// BOOK-014 W2 AC-2 walk: admin login -> Settings -> Booking; Payments + Deposit blocks; test-mode connect probe.
const { chromium } = require('/Users/xavierau/Code/js/oma/e2e/node_modules/playwright-core')
const fs = require('fs')
const [,, locale, outDir, phase] = process.argv
const BASE = 'http://localhost:3090'
const PW = fs.readFileSync(process.env.PW_FILE, 'utf8').trim()
const audit = fs.readFileSync(process.env.HOME + '/.claude/skills/ui-layout-audit/layout-audit.js', 'utf8')
const log = []
const note = (m) => { log.push(`${new Date().toISOString()} ${m}`); console.log(m) }

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } })
  const page = await ctx.newPage()
  const errors = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)) })
  page.on('pageerror', (e) => errors.push('pageerror ' + e.message.slice(0, 300)))
  let stripeNav = null
  await page.route(/stripe\.com/, (route) => {
    const u = new URL(route.request().url())
    stripeNav = `${u.host}${u.pathname.split('/').slice(0, 2).join('/')}/…`
    route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>stripe stub</body></html>' })
  })

  await page.goto(`${BASE}/login`)
  await page.fill('#email', 'w2-admin@example.test')
  await page.fill('#password', PW)
  await page.click('button[type=submit]')
  await page.waitForURL(/\/dashboard/, { timeout: 60000 })
  note(`[${locale}] logged in at ${page.url()}`)

  // Real nav: the settings link, then the bookings group.
  const settings = page.locator('a[href^="/dashboard/setup"]').first()
  await settings.click()
  await page.waitForURL(/\/dashboard\/setup/, { timeout: 60000 })
  const group = page.locator('a[href="/dashboard/setup/bookings"]').first()
  await group.click()
  await page.waitForURL(/\/dashboard\/setup\/bookings/, { timeout: 60000 })
  await page.getByTestId('booking-settings-payment-status').waitFor({ timeout: 60000 })
  await page.waitForFunction(() => !/Checking|正在檢查/.test(document.querySelector('[data-testid="booking-settings-payment-status"]')?.textContent ?? ''), null, { timeout: 30000 })
  note(`[${locale}] reached ${new URL(page.url()).pathname} via nav`)

  const state = async (label) => {
    const s = await page.evaluate(() => ({
      chip: document.querySelector('[data-testid="booking-settings-payment-status"]')?.textContent,
      connect: document.querySelector('[data-testid="booking-settings-payment-connect"]')?.textContent ?? null,
      toggleDisabled: document.querySelector('[data-testid="booking-settings-deposit-toggle"]')?.hasAttribute('disabled'),
      locked: document.querySelector('[data-testid="booking-settings-deposit-locked"]')?.textContent ?? null,
      error: document.querySelector('[data-testid="booking-settings-payment-error"]')?.textContent ?? null,
    }))
    note(`[${locale}] ${label}: ${JSON.stringify(s)}`)
    return s
  }
  const shoot = async (name) => {
    for (const [w, h] of [[1200, 900], [390, 844]]) {
      await page.setViewportSize({ width: w, height: h })
      await page.getByTestId('booking-settings-payments').scrollIntoViewIfNeeded()
      await page.waitForTimeout(300)
      const res = await page.evaluate(audit).catch((e) => ({ error: String(e).slice(0, 200) }))
      note(`[${locale}] layout audit ${name} ${w}px: ${JSON.stringify(res?.summary ?? res)}`)
      fs.writeFileSync(`${outDir}/${name}-${locale}-${w}.audit.json`, JSON.stringify(res, null, 2))
      await page.screenshot({ path: `${outDir}/${name}-${locale}-${w}.png`, fullPage: false })
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      note(`[${locale}] screenshot ${name} ${w}px, page overflow ${overflow}px`)
    }
    await page.setViewportSize({ width: 1200, height: 900 })
  }

  if (phase === 'pending') {
    await page.goto(`${BASE}/dashboard/setup/bookings?payments=return`)
    await page.getByTestId('booking-settings-payment-status').waitFor()
    await page.waitForFunction(() => !/Checking|正在檢查/.test(document.querySelector('[data-testid="booking-settings-payment-status"]')?.textContent ?? ''), null, { timeout: 30000 })
    note(`[${locale}] return landing, address now ${new URL(page.url()).pathname}${new URL(page.url()).search}`)
    await state('pending (seeded row) after return')
    await shoot('connecting')
  } else if (phase === 'active') {
    await state('active (seeded row)')
    await page.getByTestId('booking-settings-deposit-toggle').click()
    await page.getByTestId('booking-settings-deposit-amount').fill('100')
    await page.getByTestId('booking-settings-deposit-from').fill('6')
    await page.getByTestId('booking-settings-deposit-note-zh_hk').fill('取消須提前24小時通知，否則訂金不退。')
    await page.getByTestId('booking-settings-deposit-note-en').fill('Cancel 24 hours ahead or the deposit is kept.')
    const summary = await page.getByTestId('booking-settings-deposit-summary').innerText()
    note(`[${locale}] summary line: ${JSON.stringify(summary)}`)
    const [put] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith('/api/dashboard/settings/booking') && r.request().method() === 'PUT'),
      page.getByTestId('booking-settings-save').click(),
    ])
    note(`[${locale}] PUT booking settings -> ${put.status()}`)
    await page.getByTestId('booking-settings-saved').waitFor({ timeout: 15000 })
    await shoot('active-deposit-on')
    for (const [w, h] of [[1200, 900], [390, 844]]) {
      await page.setViewportSize({ width: w, height: h })
      await page.getByTestId('booking-settings-deposit').screenshot({ path: `${outDir}/deposit-block-${locale}-${w}.png` })
    }
  } else if (phase === 'paused') {
    await state('disabled account, rule on')
    const paused = await page.getByTestId('booking-settings-deposit-paused').innerText()
    note(`[${locale}] paused warning: ${JSON.stringify(paused)}`)
    await shoot('paused')
  } else if (phase === 'blocked') {
    // Account not active; the switch is locked in the UI, so prove the server's 409 with the page's own session.
    const res = await page.evaluate(async () => {
      const r = await fetch('/api/dashboard/settings/booking', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'simple', deposit: { enabled: true, mode: 'per_guest', amount: 100, fromPartySize: 1, refundNote: { zh_hk: '', en: '' } } }) })
      return { status: r.status, body: await r.json() }
    })
    note(`[${locale}] PUT deposit on while not active -> ${JSON.stringify(res)}`)
  }

  if (phase === 'probe') await state('before connect')
  if (phase === 'probe') await shoot('before-connect')

  if (phase === 'probe') {
    const btn = page.getByTestId('booking-settings-payment-connect')
    const [resp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/dashboard/settings/payments/connect'), { timeout: 60000 }),
      btn.click(),
    ])
    note(`[${locale}] POST connect -> ${resp.status()}`)
    const body = await resp.json().catch(() => null)
    if (resp.status() !== 200) note(`[${locale}] connect body: ${JSON.stringify(body)}`)
    await page.waitForTimeout(3000)
    if (resp.status() !== 200) { await state('connect refused'); await shoot('connect-error') }
    note(`[${locale}] browser sent to: ${stripeNav ?? '(no stripe navigation)'}`)
    // The provider's return redirect (no account id; an attacker-added ?account= must change nothing).
    await page.goto(`${BASE}/dashboard/setup/bookings?payments=return&account=acct_attacker`)
    await page.getByTestId('booking-settings-payment-status').waitFor()
    await page.waitForFunction(() => !/Checking|正在檢查/.test(document.querySelector('[data-testid="booking-settings-payment-status"]')?.textContent ?? ''), null, { timeout: 30000 })
    note(`[${locale}] after return, address is ${new URL(page.url()).pathname}${new URL(page.url()).search}`)
    await state('after return')
    await shoot('returned')
  }

  note(`[${locale}] console errors: ${errors.length}${errors.length ? ' ' + JSON.stringify(errors) : ''}`)
  fs.appendFileSync(`${outDir}/walk.log`, log.join('\n') + '\n')
  await browser.close()
})().catch((e) => { console.error(e); fs.appendFileSync(`${outDir}/walk.log`, log.join('\n') + `\nFAILED ${e.message}\n`); process.exit(1) })
