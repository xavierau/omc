// AGENT-001 W2 browser walk (scratchpad only). Usage: node walk.cjs <phase> [arg]
// phases: settings-shadow | set-auto | set-model <id> | log | shots
const { chromium } = require('playwright')
const fs = require('fs')
const path = require('path')
const APP = process.env.APP
const OUT = process.env.OUT
const AUDIT = fs.readFileSync(path.join(process.env.HOME, '.claude/skills/ui-layout-audit/layout-audit.js'), 'utf8')
const [phase, arg] = process.argv.slice(2)
const log = (...a) => console.log(new Date().toISOString(), phase, ...a)

async function login(page) {
  await page.goto(`${APP}/login`)
  await page.getByLabel(/email|電郵/i).fill(process.env.ADMIN_EMAIL)
  await page.getByLabel(/password|密碼/i).fill(process.env.ADMIN_PASSWORD)
  await page.getByRole('button', { name: /sign in|登入/i }).click()
  await page.waitForURL(`${APP}/dashboard`, { timeout: 60000 })
  log('logged in')
}

async function hideDevPortal(page) {
  await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' }).catch(() => {})
}

async function audit(page, name) {
  await page.waitForTimeout(400)
  await hideDevPortal(page)
  const result = await page.evaluate(AUDIT)
  fs.writeFileSync(path.join(OUT, `${name}.audit.json`), JSON.stringify(result, null, 2))
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true })
  log('audit', name, JSON.stringify(result.summary), 'scrollW', result.page.scrollW, 'vw', result.viewport.w)
  return result
}

async function setupSection(page) {
  await page.goto(`${APP}/dashboard/setup`)
  const section = page.getByTestId('agent-settings-section')
  await section.waitFor({ timeout: 60000 })
  await section.scrollIntoViewIfNeeded()
  return section
}

async function save(page) {
  await page.getByTestId('agent-settings-save').click()
  await page.getByTestId('agent-settings-saved').waitFor({ timeout: 20000 })
  const adjusted = await page.getByTestId('agent-settings-adjusted').textContent().catch(() => null)
  log('saved', adjusted ? `adjusted: ${adjusted}` : '')
}

async function run() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await ctx.newPage()
  page.on('console', (m) => { if (m.type() === 'error') log('console.error', m.text().slice(0, 200)) })
  await login(page)

  if (phase === 'settings-shadow') {
    await setupSection(page)
    await page.getByTestId('agent-settings-mode-shadow').check()
    await page.getByTestId('agent-settings-knowledge').fill(arg)
    await page.getByTestId('agent-settings-instructions').fill('Friendly and short. Reply in the language the diner used.')
    await save(page)
    await page.reload()
    await setupSection(page)
    const checked = await page.getByTestId('agent-settings-mode-shadow').isChecked()
    const knowledge = await page.getByTestId('agent-settings-knowledge').inputValue()
    log('after reload: shadow checked =', checked, '; knowledge persisted =', knowledge === arg, `(${knowledge.length} chars)`)
    log('counter', await page.getByTestId('agent-settings-knowledge-count').textContent())
  } else if (phase === 'set-auto') {
    await setupSection(page)
    await page.getByTestId('agent-settings-mode-auto').check()
    await save(page)
  } else if (phase === 'set-model') {
    await setupSection(page)
    await page.getByTestId('agent-settings-advanced-toggle').click()
    await page.getByTestId('agent-settings-model').fill(arg)
    await save(page)
    log('model field now', await page.getByTestId('agent-settings-model').inputValue())
  } else if (phase === 'log') {
    await page.getByRole('link', { name: /AI agent|AI 助手/ }).click()
    await page.waitForURL(`${APP}/dashboard/agent`)
    log('reached', page.url(), 'by clicking the nav entry')
    const list = page.getByTestId('agent-log-thread-list')
    await list.waitFor({ timeout: 30000 })
    const rows = list.locator('[data-testid^="agent-log-thread-row-"]')
    log('threads', await rows.count(), JSON.stringify(await rows.allInnerTexts()))
    await rows.first().click()
    await page.getByTestId('agent-log-detail').locator('li').first().waitFor({ timeout: 30000 })
    log('detail', JSON.stringify((await page.getByTestId('agent-log-detail').innerText()).slice(0, 3000)))
  } else if (phase === 'api-checks') {
    const r = page.request
    const list = await r.get(`${APP}/api/dashboard/agent/conversations`)
    const listText = await list.text()
    log('admin A list', list.status(), 'contains full phone:', listText.includes('90000001'), 'contains tenant B key:', listText.includes('cccccccc'))
    const other = await r.get(`${APP}/api/dashboard/agent/conversations/cccccccc-0000-4000-8000-00000000000b`)
    log("admin A + tenant B's thread key:", other.status(), await other.text())
    const key = JSON.parse(listText).threads[0].key
    const own = await r.get(`${APP}/api/dashboard/agent/conversations/${key}`)
    const ownText = await own.text()
    log('admin A own thread', own.status(), 'contains full phone:', ownText.includes('90000001'))
    const stale = await r.put(`${APP}/api/dashboard/settings/agent`, { data: { rev: 0, config: { mode: 'auto' } } })
    log('PUT with stale rev 0:', stale.status(), await stale.text())
  } else if (phase === 'staff-checks') {
    const r = page.request
    for (const url of ['/api/dashboard/agent/conversations', '/api/dashboard/agent/conversations/cccccccc-0000-4000-8000-00000000000b']) {
      const res = await r.get(`${APP}${url}`)
      log('staff GET', url, res.status(), await res.text())
    }
    const put = await r.put(`${APP}/api/dashboard/settings/agent`, { data: { rev: 1, config: { mode: 'auto' } } })
    log('staff PUT settings', put.status(), await put.text())
    const get = await r.get(`${APP}/api/dashboard/settings/agent`)
    log('staff GET settings', get.status(), (await get.json()).canEdit === false ? 'canEdit=false' : 'canEdit!=false')
    await page.goto(`${APP}/dashboard/agent`)
    await page.getByTestId('agent-log-forbidden').waitFor({ timeout: 30000 })
    await audit(page, 'log-forbidden-staff-1280')
  } else if (phase === 'shots') {
    for (const [w, h] of [[1280, 900], [390, 844]]) {
      await page.setViewportSize({ width: w, height: h })
      await setupSection(page)
      await audit(page, `setup-${w}`)
      await page.getByTestId('agent-settings-advanced-toggle').click()
      await audit(page, `setup-advanced-${w}`)
      await page.goto(`${APP}/dashboard/agent`)
      await page.getByTestId('agent-log-thread-list').waitFor({ timeout: 30000 })
      await audit(page, `log-list-${w}`)
      await page.locator('[data-testid^="agent-log-thread-row-"]').first().click()
      await page.getByTestId('agent-log-detail').locator('li').first().waitFor({ timeout: 30000 })
      await audit(page, `log-detail-${w}`)
    }
  }
  await browser.close()
}
run().catch((e) => { console.error(phase, 'FAILED', e.message); process.exit(1) })
