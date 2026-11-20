// AGENT-003 local browser walk (scratchpad only). Usage: node walk.cjs <phase> <tag>
// phases: setup | bookings | log
const { chromium } = require('playwright')
const fs = require('fs')
const path = require('path')
const APP = process.env.APP
const OUT = process.env.OUT
const AUDIT = fs.readFileSync(path.join(process.env.HOME, '.claude/skills/ui-layout-audit/layout-audit.js'), 'utf8')
const [phase, tag = 'en'] = process.argv.slice(2)
const log = (...a) => console.log(new Date().toISOString(), phase, tag, ...a)

async function login(page) {
  await page.goto(`${APP}/login`)
  await page.getByLabel(/email|電郵/i).fill(process.env.ADMIN_EMAIL)
  await page.getByLabel(/password|密碼/i).fill(process.env.ADMIN_PASSWORD)
  await page.getByRole('button', { name: /sign in|登入/i }).click()
  await page.waitForURL(`${APP}/dashboard`, { timeout: 90000 })
  log('logged in')
}

async function audit(page, name, scope) {
  await page.waitForTimeout(400)
  await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' }).catch(() => {})
  const result = await page.evaluate(AUDIT)
  fs.writeFileSync(path.join(OUT, `${name}.audit.json`), JSON.stringify(result, null, 2))
  if (scope) await scope.screenshot({ path: path.join(OUT, `${name}.png`) })
  else await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true })
  log('audit', name, JSON.stringify(result.summary), 'scrollW', result.page.scrollW, 'vw', result.viewport.w)
}

async function run() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await ctx.newPage()
  page.on('console', (m) => { if (m.type() === 'error') log('console.error', m.text().slice(0, 200)) })
  await login(page)
  if (phase === 'setup') {
    for (const [w, h] of [[1280, 900], [390, 844]]) {
      await page.setViewportSize({ width: w, height: h })
      await page.goto(`${APP}/dashboard/setup`)
      const section = page.getByTestId('agent-settings-section')
      await section.waitFor({ timeout: 90000 })
      await page.getByTestId('agent-settings-advanced-toggle').click()
      const fb = page.getByTestId('agent-settings-fallback-model')
      await fb.scrollIntoViewIfNeeded()
      const tools = {}
      for (const n of ['propose_booking', 'create_booking_request', 'get_booking_link']) {
        tools[n] = await page.getByTestId(`agent-settings-tool-${n}`).isChecked()
      }
      log('fallback field visible', await fb.isVisible(), 'placeholder', await fb.getAttribute('placeholder'), 'tools checked', JSON.stringify(tools))
      log('advanced text', JSON.stringify((await page.getByTestId('agent-settings-advanced').innerText()).slice(0, 1500)))
      await audit(page, `setup-advanced-${tag}-${w}`, page.getByTestId('agent-settings-advanced'))
    }
  } else if (phase === 'bookings') {
    await page.goto(`${APP}/dashboard/bookings`)
    const row = page.locator('[data-testid^="booking-row-"][data-testid$="-via-agent"]').first()
    await row.waitFor({ timeout: 90000 })
    const li = page.locator('li[data-testid^="booking-row-"]').first()
    log('rows', await page.locator('li[data-testid^="booking-row-"]').count(), 'first row', JSON.stringify(await li.innerText()))
    await audit(page, `bookings-${tag}-1280`)
  } else if (phase === 'log') {
    await page.goto(`${APP}/dashboard/agent`)
    const list = page.getByTestId('agent-log-thread-list')
    await list.waitFor({ timeout: 90000 })
    await list.locator('[data-testid^="agent-log-thread-row-"]').first().click()
    await page.getByTestId('agent-log-detail').locator('li').first().waitFor({ timeout: 30000 })
    log('detail', JSON.stringify((await page.getByTestId('agent-log-detail').innerText()).slice(0, 3000)))
    await audit(page, `agent-log-${tag}-1280`)
  }
  await browser.close()
}
run().catch((e) => { console.error(phase, 'FAILED', e.message); process.exit(1) })
