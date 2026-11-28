// BOOK-013 r2 (AC-26 manual link) local walk driver, fake data only. Helpers copied from ../2026-11-27-book-013-phone-optional/walk.mjs
// (DB port 55422: this repo's stack ran on shifted ports because another project's stack held 54321/54322).
// Usage: node walk-r2.mjs <locale> <width> <password-file>; dev server on :3060 with NEXT_PUBLIC_DEFAULT_LOCALE=<locale>.
import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const [locale, widthArg, passwordFile] = process.argv.slice(2)
const password = fs.readFileSync(passwordFile, 'utf8').trim()
const W = Number(widthArg)
const phone = W < 600
const H = phone ? 844 : 900
const OUT = path.dirname(new URL(import.meta.url).pathname)
const BASE = 'http://localhost:3060'
const RID = '11111111-1111-4111-8111-111111111111'
const CHROME = `${os.homedir()}/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`
const AUDIT = fs.readFileSync(`${os.homedir()}/.claude/skills/ui-layout-audit/layout-audit.js`, 'utf8')
const PORT = 9300 + (W % 97)
const tag = `${locale === 'en' ? 'en' : 'zh'}-${W}`
const steps = []

const sql = (q) => execFileSync('psql', ['-h', '127.0.0.1', '-p', '55422', '-U', 'postgres', '-d', 'postgres', '-Atc', q], { env: { ...process.env, PGPASSWORD: 'postgres' } }).toString().trim()
const idOf = (name) => sql(`select id from booking_requests where restaurant_id='${RID}' and name='${name}' order by created_at desc limit 1`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'b13r2-'))
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${dir}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' })
let target
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200)
  try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page') } catch {}
}
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r, { once: true }))
let seq = 0
const pending = new Map()
const consoleErrors = []
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  if (m.method === 'Runtime.exceptionThrown') consoleErrors.push(m.params.exceptionDetails.text)
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') consoleErrors.push(m.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 300))
})
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })) })
const evaluate = async (expression) => {
  const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (res.result?.exceptionDetails) throw new Error(`${expression.slice(0, 80)}: ${res.result.exceptionDetails.exception?.description ?? res.result.exceptionDetails.text}`)
  return res.result?.result?.value
}
await send('Page.enable'); await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: phone ? 2 : 1, mobile: false })

const q = (sel) => `([...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => e.getClientRects().length > 0) ?? null)`
const exists = (sel) => evaluate(`!!${q(sel)}`)
async function waitFor(sel, ms = 20000) {
  for (let t = 0; t < ms; t += 200) { if (await exists(sel)) return; await sleep(200) }
  throw new Error(`timeout waiting for ${sel}`)
}
async function waitUntil(expr, ms = 15000) {
  for (let t = 0; t < ms; t += 200) { if (await evaluate(expr)) return true; await sleep(200) }
  return false
}
async function goto(url, sel) {
  await send('Page.navigate', { url: BASE + url }); await sleep(800)
  if (sel) await waitFor(sel, 90000)
  await sleep(600)
}
async function click(sel) {
  await waitFor(sel)
  if (await evaluate(`${q(sel)}.getAttribute('role') === 'menuitem'`)) {
    await evaluate(`${q(sel)}.focus()`)
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
    await sleep(600)
    return
  }
  const r = await evaluate(`(() => { const e = ${q(sel)}; e.scrollIntoView({ block: 'center' }); const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 } })()`)
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'left', clickCount: 1, pointerType: 'mouse' })
  await sleep(500)
}
async function type(sel, text) {
  await click(sel)
  await evaluate(`(() => { const e = ${q(sel)}; e.select?.(); })()`)
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 })
  if (text) await send('Input.insertText', { text })
  await sleep(500)
}
const url = () => evaluate('location.pathname + location.search')
async function shot(name, note) {
  await sleep(500)
  const audit = await evaluate(AUDIT).catch((e) => ({ error: String(e) }))
  await evaluate('window.scrollTo(0,0)').catch(() => {})
  const file = `${name}-${tag}.jpeg`
  const img = await send('Page.captureScreenshot', { format: 'jpeg', quality: 70 })
  fs.writeFileSync(path.join(OUT, file), Buffer.from(img.result.data, 'base64'))
  const blocking = (audit?.findings ?? []).filter((f) => f.sev === 'blocking')
  const warnings = (audit?.findings ?? []).filter((f) => f.sev === 'warning').map((f) => `${f.check}: ${String(f.el).slice(0, 90)} | ${String(f.detail).slice(0, 120)}`)
  steps.push({ step: name, note, file, url: await url(), audit: audit?.summary ?? audit, viewport: audit?.viewport, blocking, warnings })
  console.log(`${file}  blocking=${audit?.summary?.blocking ?? '?'} warning=${audit?.summary?.warning ?? '?'}`)
}
const check = (name, ok, detail) => { steps.push({ check: name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail ?? ''}`) }

/** A viewport screenshot with `sel` scrolled into the middle (shot() scrolls to the top for its audit). */
async function focusShot(name, sel, note) {
  await evaluate(`${q(sel)}.scrollIntoView({ block: 'center' })`)
  await sleep(500)
  const file = `${name}-${tag}.jpeg`
  const img = await send('Page.captureScreenshot', { format: 'jpeg', quality: 70 })
  fs.writeFileSync(path.join(OUT, file), Buffer.from(img.result.data, 'base64'))
  steps.push({ step: name, note, file, focus: sel })
}
const todayHK = sql(`select (now() at time zone 'Asia/Hong_Kong')::date`)
const NP = idOf('Walk-in Ho') // phone-less staff booking (seed-walk-r2.sh)
const WP = idOf('Mr Chan') // staff booking with a phone, unlinked
const MEMBER = sql(`select id from members where restaurant_id='${RID}' and name='Lam Chi Keung' limit 1`)
const linkSel = (id) => `[data-testid="booking-row-${id}-member-link"]`
const rowSel = (id) => `[data-testid="booking-row-${id}"]`
const relinkEvents = (id) => sql(`select count(*) from events where type='booking.member_relinked' and data_json->>'bookingId'='${id}'`)
async function view(v) {
  if (await exists(`[data-testid=bookings-view-${v}]`)) { await click(`[data-testid=bookings-view-${v}]`); return 'nav' }
  await goto(`/dashboard/bookings?view=${v}`); return 'url'
}

try {
  await goto('/login', 'input[type=email]')
  await type('input[type=email]', 'walk-admin@example.test')
  await type('input[type=password]', password)
  await click('button[type=submit]')
  await sleep(3000)
  await goto('/dashboard/bookings', '[data-testid=bookings-view-today], [data-testid=bookings-today-list]')
  check('seed: phone-less booking NP and phone booking WP exist, both unlinked', NP && WP && sql(`select count(*) from booking_requests where id in ('${NP}','${WP}') and member_id is null`) === '2', `${NP} ${WP}`)

  // Today: the BOOK-008 link control is not part of the Today rows at all.
  let how = await view('today')
  await waitFor(rowSel(NP), 30000)
  check(`today (${how}): phone-less row shown, no link action`, (await exists(rowSel(NP))) && !(await exists(linkSel(NP))))
  check(`today: no row offers the link control (Today has none)`, !(await evaluate(`!!document.querySelector('[data-testid$="-member-link"]')`)))
  await shot('01-today', 'Today: phone-less Walk-in Ho, no member link control in Today')

  // Calendar day panel.
  how = await view('calendar')
  await click(`[data-testid=bookings-calendar-day-${todayHK}]`)
  await waitFor(rowSel(NP), 30000)
  check(`calendar day panel (${how}): phone-less row has no link action`, !(await exists(linkSel(NP))))
  check('calendar day panel: the booking with a phone still offers Link member', await exists(linkSel(WP)))
  await shot('02-calendar-day', 'Calendar day panel: Walk-in Ho without Link member, Mr Chan with it')
  await focusShot('02b-calendar-np-focus', rowSel(NP), 'Phone-less row in the day panel, no Link member')
  await focusShot('02c-calendar-wp-focus', rowSel(WP), 'Row with a phone in the day panel, Link member offered')

  // Table.
  how = await view('table')
  await waitFor(rowSel(NP), 30000)
  check(`table (${how}): phone-less row has no link action`, !(await exists(linkSel(NP))))
  check('table: the booking with a phone still offers Link member', await exists(linkSel(WP)))
  await shot('03-table', 'Table: Walk-in Ho without Link member, Mr Chan with it')
  await focusShot('03b-table-np-focus', rowSel(NP), 'Phone-less row in the table, no Link member')

  // API with the signed-in session: link refused on NP, nothing written.
  const res = await evaluate(`fetch('/api/dashboard/bookings/${NP}/member', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ memberId: '${MEMBER}' }) }).then(async (r) => ({ status: r.status, body: await r.json() }))`)
  check('API: link on phone-less booking → 400 phone_required', res.status === 400 && res.body?.error === 'phone_required', JSON.stringify(res))
  check('API: member_id still NULL, no member_relinked event', sql(`select coalesce(member_id::text,'NULL') from booking_requests where id='${NP}'`) === 'NULL' && relinkEvents(NP) === '0')
  // The booking with a phone still links through the UI (real click), then is unlinked to restore the seed.
  await click(linkSel(WP))
  await waitFor(`[data-testid="booking-row-${WP}-member-search"]`)
  await type(`[data-testid="booking-row-${WP}-member-search"]`, 'Lam')
  await waitFor(`[data-testid="booking-row-${WP}-member-option-${MEMBER}"]`)
  await click(`[data-testid="booking-row-${WP}-member-option-${MEMBER}"]`)
  const linked = await waitUntil(`(() => !!document.querySelector('[data-testid="booking-row-${WP}-member-unlink"]'))()`)
  check('UI: booking with a phone links through Link member (unchanged behaviour)', linked && sql(`select member_id from booking_requests where id='${WP}'`) === MEMBER && relinkEvents(WP) === '1')
  await shot('04-table-wp-linked', 'Mr Chan linked through the UI; Change / Unlink offered')
  await click(`[data-testid="booking-row-${WP}-member-unlink"]`)
  const unlinked = await waitUntil(`(() => !!document.querySelector('${linkSel(WP).replace(/"/g, '\\"')}') && !document.querySelector('[data-testid="booking-row-${WP}-member-unlink"]'))()`)
  check('UI: unlink still works', unlinked && sql(`select coalesce(member_id::text,'NULL') from booking_requests where id='${WP}'`) === 'NULL')
  check('console: 0 errors', consoleErrors.length === 0, JSON.stringify(consoleErrors).slice(0, 300))
} catch (err) {
  steps.push({ error: String(err.stack ?? err) })
  console.error('WALK ERROR', err)
  const img = await send('Page.captureScreenshot', { format: 'jpeg', quality: 60 })
  fs.writeFileSync(path.join(OUT, `zz-error-${tag}.jpeg`), Buffer.from(img.result.data, 'base64'))
} finally {
  steps.push({ consoleErrors })
  fs.writeFileSync(path.join(OUT, `walk-steps-${tag}.json`), JSON.stringify(steps, null, 2))
  ws.close(); chrome.kill()
  await sleep(500); try { fs.rmSync(dir, { recursive: true, force: true }) } catch {}
}
