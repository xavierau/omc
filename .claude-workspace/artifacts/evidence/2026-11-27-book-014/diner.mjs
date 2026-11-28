// BOOK-014 W6b diner driver (Playwright, cached Chromium). Commands:
//   book <bUrl> <party> <yyyy-mm-dd> <HHMM> <name> <shot> [locale]  -> prints the checkout URL (screenshots /b + Checkout)
//   pay <checkoutUrl> <shot> [card] [currency HKD|LOCAL] [locale]     -> pays, follows the return, screenshots /p
//   shot <url> <file> [locale] [width]
//   open <checkoutUrl> <shot>                                          -> screenshot Checkout only
import { chromium } from 'playwright-core'
import os from 'node:os'
const EXE = `${os.homedir()}/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`
const EV = process.env.EVID
const [cmd, ...a] = process.argv.slice(2)
const browser = await chromium.launch({ executablePath: EXE, headless: true })
const mk = async (locale = 'zh-HK', width = 1200) => (await browser.newContext({ locale, viewport: { width, height: width < 600 ? 844 : 900 }, deviceScaleFactor: 1 })).newPage()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function inFrames(page, sel, timeout = 20000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    for (const f of page.frames()) {
      const l = f.locator(sel)
      try { if (await l.count()) return l.first() } catch {}
    }
    await sleep(300)
  }
  throw new Error(`not found: ${sel}`)
}
async function pickHKD(page) {
  try { const b = await inFrames(page, '#currency-hkd', 8000); await b.check({ force: true }); await sleep(2000); return 'HKD' } catch { return 'none-offered' }
}
async function pickLocal(page) {
  try { const b = await inFrames(page, '#currency-twd', 8000); await b.check({ force: true }); await sleep(2000); return 'TWD' } catch { return 'none-offered' }
}
try {
  if (cmd === 'book') {
    const [url, party, date, hhmm, name, shot, locale = 'zh-HK'] = a
    const p = await mk(locale)
    await p.goto(url)
    await p.getByTestId(`booking-party-${party}`).click()
    await p.getByTestId(`booking-day-${date}`).click()
    await p.getByTestId(`booking-slot-${hhmm}`).click()
    await p.getByTestId('booking-name-input').fill(name)
    await p.screenshot({ path: `${EV}/${shot}-b-form.png`, fullPage: true })
    const t0 = Date.now()
    await p.getByTestId('booking-submit').click()
    await p.waitForURL(/checkout\.stripe\.com/, { timeout: 20000 })
    const ms = Date.now() - t0
    await p.waitForLoadState('networkidle').catch(() => {})
    await sleep(1500)
    await p.screenshot({ path: `${EV}/${shot}-checkout.png` })
    console.log(JSON.stringify({ checkout: p.url().split('#')[0], redirectMs: ms }))
  } else if (cmd === 'open') {
    const [url, shot] = a
    const p = await mk()
    await p.goto(url); await sleep(3000)
    const cur = await pickHKD(p)
    await p.screenshot({ path: `${EV}/${shot}.png` })
    console.log(JSON.stringify({ currency: cur, text: (await p.locator('body').innerText()).slice(0, 300) }))
  } else if (cmd === 'pay') {
    const [url, shot, card = '4242424242424242', currency = 'HKD', locale = 'zh-HK'] = a
    const p = await mk(locale)
    await p.goto(url); await p.waitForURL(/checkout\.stripe\.com/, { timeout: 20000 }); await sleep(2500)
    await sleep(2000); let cur = currency === 'HKD' ? await pickHKD(p) : await pickLocal(p); if (cur === 'none-offered' && currency === 'HKD') { await sleep(3000); cur = await pickHKD(p) }
    const amount = (await p.locator('body').innerText()).match(/(HK|NT)\$[\d,.]+/g)
    const email = await inFrames(p, '#paymentForm-emailInput, #linkAuthentication-emailInput'); await email.fill('w6b-diner@example.com'); await sleep(1500)
    const num = await inFrames(p, '#payment-numberInput'); await num.fill(card)
    await (await inFrames(p, '#payment-expiryInput')).fill('12 / 34')
    await (await inFrames(p, '#payment-cvcInput')).fill('123')
    await (await inFrames(p, '#payment-nameInput')).fill('W6b Test Diner')
    try { const c = await inFrames(p, '#payment-countryInput', 2000); await c.selectOption('HK') } catch {}
    try { const z = await inFrames(p, '#billingPostalCode', 1000); if (await z.isVisible()) await z.fill('00000') } catch {}
    try { const s = await inFrames(p, '#payment-linkOptInInput', 1000); if (await s.isChecked()) await s.uncheck({ force: true }) } catch {}
    await p.screenshot({ path: `${EV}/${shot}-checkout-filled.png` })
    if (process.env.WAIT_FLAG) { const fs = await import('node:fs'); fs.writeFileSync(process.env.WAIT_FLAG + '.ready', '1'); while (!fs.existsSync(process.env.WAIT_FLAG)) await sleep(250) }
    await (await inFrames(p, 'button[type=submit]:has-text("付款"), button[type=submit]:has-text("Pay")')).click()
    await p.waitForURL(/localhost:3080\/p\//, { timeout: 45000 })
    await sleep(2500)
    await p.screenshot({ path: `${EV}/${shot}-p-return.png`, fullPage: true })
    console.log(JSON.stringify({ currency: cur, amountShown: amount, returnUrl: p.url(), text: (await p.locator('body').innerText()).slice(0, 500) }))
  } else if (cmd === 'shot') {
    const [url, file, locale = 'zh-HK', width = '1200'] = a
    const p = await mk(locale, Number(width))
    await p.goto(url); await sleep(1500)
    await p.screenshot({ path: `${EV}/${file}`, fullPage: true })
    const tid = await p.locator('[data-testid^="booking-pay-"]').evaluateAll((es) => es.map((e) => e.getAttribute('data-testid')))
    console.log(JSON.stringify({ testids: tid, text: (await p.locator('body').innerText()).slice(0, 600) }))
  }
} catch (e) {
  console.log(JSON.stringify({ error: String(e).slice(0, 500) }))
  process.exitCode = 1
} finally { await browser.close() }
