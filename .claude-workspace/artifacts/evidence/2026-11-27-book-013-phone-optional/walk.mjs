// BOOK-013 decision 9 (S8, phone optional) local walk driver (fake data only), built on the r3 driver. Drives a headless Chromium over
// the DevTools protocol (Node 22 global WebSocket, no dependency), takes the
// screenshots, runs the ui-layout-audit script on each screen and writes
// walk-steps-<locale>-<width>.json. Usage:
//   node walk.mjs <locale> <width> <password-file>
// The dev server (port 3060) must run with NEXT_PUBLIC_DEFAULT_LOCALE=<locale>.
// Viewports are plain (desktop 1440x900 DPR 1, phone 390x844 DPR 2), no mobile/touch flags (ui-layout-audit §1).
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

const sql = (q) => execFileSync('psql', ['-h', '127.0.0.1', '-p', '54322', '-U', 'postgres', '-d', 'postgres', '-Atc', q], { env: { ...process.env, PGPASSWORD: 'postgres' } }).toString().trim()
const idOf = (name) => sql(`select id from booking_requests where restaurant_id='${RID}' and name='${name}' order by created_at desc limit 1`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'b13d9-'))
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
async function setValue(sel, value) {
  await evaluate(`(() => { const e = ${q(sel)}; const proto = e instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(e, ${JSON.stringify(value)}); e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })) })()`)
  await sleep(900)
}
const text = (sel) => evaluate(`(${q(sel)}?.innerText ?? '').trim()`)
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

// The Today rows in DOM order, as booking names (row test id = booking-row-<uuid>).
const rowNames = async () => {
  const ids = await evaluate(`[...document.querySelectorAll('[data-testid^="booking-row-"]')].map((e) => e.dataset.testid).filter((t) => /^booking-row-[0-9a-f-]{36}$/.test(t)).map((t) => t.slice(12))`)
  return ids.map((id) => sql(`select coalesce(name,'') from booking_requests where id='${id}'`))
}
const todayRows = () => sql(`select name || '|' || to_char(booking_time,'HH24:MI') || '|' || party_size from booking_requests where restaurant_id='${RID}' and booking_date=(now() at time zone 'Asia/Hong_Kong')::date and status in ('pending','confirmed','no_show') order by booking_time, name`).split('\n').map((l) => { const [name, time, party] = l.split('|'); return { name, time, party: Number(party) } })
const collator = new Intl.Collator(locale)
const byName = (rows) => [...rows].sort((a, b) => collator.compare(a.name, b.name) || a.time.localeCompare(b.time)).map((r) => r.name)
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

async function sortBy(key, dir) {
  if (phone) return setValue('[data-testid=bookings-today-sort]', `${key}:${dir}`)
  await click(`[data-testid=bookings-today-sort-${key}]`)
  await sleep(700)
}
async function activeSort() {
  if (phone) return evaluate(`${q('[data-testid=bookings-today-sort]')}.value`)
  return evaluate(`(() => { const h = document.querySelector('[role=columnheader][aria-sort]'); return h ? h.querySelector('button').dataset.testid.replace('bookings-today-sort-', '') + ':' + (h.getAttribute('aria-sort') === 'ascending' ? 'asc' : 'desc') : null })()`)
}

const todayHK = sql(`select (now() at time zone 'Asia/Hong_Kong')::date`)
const logFile = path.join(OUT, 'kapso-fake.jsonl')
const logLines = () => (fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean) : [])
/** WhatsApp message sends (POST …/messages) logged by the fake since line `from`. */
const sendsSince = (from) => logLines().slice(from).map((l) => JSON.parse(l)).filter((s) => /\/messages$/.test(s.path))
const EN = locale === 'en'
const NO_PHONE = EN ? 'No phone' : '未有電話'
const HINT = EN ? 'No phone, no WhatsApp message' : '沒有電話，不會發送 WhatsApp'
const OPTIONAL = EN ? 'Phone (optional)' : '電話（選填）'
const PLAIN = EN ? 'Phone' : '電話'
const notifyState = (sel = '[data-testid=booking-form-notify]') =>
  evaluate(`(() => { const e = ${q(sel)}; return { checked: e.checked, disabled: e.disabled, hint: e.closest('label').innerText.replace(/\\s+/g, ' ') } })()`)
const phoneLabel = () => evaluate(`document.querySelector('label[for=booking-form-phone]').innerText.trim()`)
const rowOf = (name) => sql(`select coalesce(phone,'NULL')||'|'||coalesce(member_id::text,'NULL')||'|'||(case when notify_diner then 't' else 'f' end)||'|'||status||'|'||source from booking_requests where restaurant_id='${RID}' and name='${name}' order by created_at desc limit 1`)
/** A viewport screenshot with `sel` scrolled into the middle (shot() scrolls to the top for its audit). */
async function focusShot(name, sel, note) {
  await evaluate(`${q(sel)}.scrollIntoView({ block: 'center' })`)
  await sleep(500)
  const file = `${name}-${tag}.jpeg`
  const img = await send('Page.captureScreenshot', { format: 'jpeg', quality: 70 })
  fs.writeFileSync(path.join(OUT, file), Buffer.from(img.result.data, 'base64'))
  steps.push({ step: name, note, file, focus: sel })
}
async function openMenu(id, action) {
  await goto('/dashboard/bookings?view=table', `[data-testid=booking-row-${id}-menu]`)
  await click(`[data-testid=booking-row-${id}-menu]`)
  await click(`[data-testid=booking-row-${id}-${action}]`)
}

try {
  // Login (real form).
  await goto('/login', 'input[type=email]')
  await type('input[type=email]', 'walk-admin@example.test')
  await type('input[type=password]', password)
  await click('button[type=submit]')
  await sleep(3000)
  const start = logLines().length

  // 1. AC-26: new booking without a phone, from Today.
  await goto(phone ? '/dashboard/bookings' : '/dashboard/bookings?view=today', '[data-testid=bookings-today-list]')
  await click('[data-testid=booking-new-button]')
  await waitFor('[data-testid=booking-form-phone]')
  check('form: phone label marked optional', (await phoneLabel()) === OPTIONAL, await phoneLabel())
  let ns = await notifyState()
  check('form: empty phone → Notify unticked + disabled + hint', !ns.checked && ns.disabled && ns.hint.includes(HINT), JSON.stringify(ns))
  await type('[data-testid=booking-form-phone]', '9123')
  ns = await notifyState()
  check('form: typing a phone makes Notify available, ticked', ns.checked && !ns.disabled && !ns.hint.includes(HINT), JSON.stringify(ns))
  await type('[data-testid=booking-form-phone]', '')
  ns = await notifyState()
  check('form: clearing the phone disables Notify again', !ns.checked && ns.disabled, JSON.stringify(ns))
  await type('[data-testid=booking-form-name]', 'Walk-in Ho')
  await type('[data-testid=booking-form-partySize]', '3')
  await setValue('[data-testid=booking-form-date]', todayHK)
  await waitFor('[data-testid=booking-form-slot-1830]')
  await click('[data-testid=booking-form-slot-1830]')
  await shot('01-form-no-phone', 'New booking with no phone: Notify off and disabled, hint shown')
  await focusShot('01b-form-notify-focus', '[data-testid=booking-form-notify]', 'Notify off + disabled with the no-phone hint')
  const beforeCreate = logLines().length
  await click('[data-testid=booking-form-save]')
  await waitFor('[data-testid=booking-toast]')
  check('create: confirmed, source staff, phone NULL, no member, notify false', rowOf('Walk-in Ho') === 'NULL|NULL|f|confirmed|staff', rowOf('Walk-in Ho'))
  const toastKind = await evaluate(`${q('[data-testid=booking-toast]')}.dataset.kind`)
  check('create: toast "added", no not-delivered warning', toastKind === 'added', toastKind)
  await sleep(1500)
  check('create: zero WhatsApp sends', sendsSince(beforeCreate).length === 0, String(sendsSince(beforeCreate).length))
  await shot('02-created-toast', 'Saved; toast without a WhatsApp warning')
  const ho = idOf('Walk-in Ho')

  // 2. AC-27: Today row / phone card shows No phone; search by name finds it, by digits skips it; Arrived/Undo.
  await goto(phone ? '/dashboard/bookings' : '/dashboard/bookings?view=today', `[data-testid=booking-row-${ho}]`)
  check('today: the row shows "No phone"', (await text(`[data-testid=booking-row-${ho}]`)).includes(NO_PHONE), (await text(`[data-testid=booking-row-${ho}]`)).replace(/\s+/g, ' ').slice(0, 120))
  await shot('03-today-no-phone', 'Today: the phone-less booking shows No phone')
  await focusShot('03b-today-row-focus', `[data-testid=booking-row-${ho}]`, 'Today row / card: No phone')
  await type('[data-testid=bookings-today-search]', 'Walk-in')
  check('today search "Walk-in": only Walk-in Ho', same(await rowNames(), ['Walk-in Ho']), JSON.stringify(await rowNames()))
  await shot('04-today-search-name', 'Today search by name finds it')
  await type('[data-testid=bookings-today-search]', '9123')
  check('today search "9123": Walk-in Ho skipped', !(await rowNames()).includes('Walk-in Ho'), JSON.stringify(await rowNames()))
  await type('[data-testid=bookings-today-search]', '')
  await click(`[data-testid=booking-row-${ho}-arrived]`)
  await waitFor(`[data-testid=booking-row-${ho}-arrived-at]`)
  check('arrived: checked_in_at set, still confirmed', sql(`select status || ' ' || (checked_in_at is not null) from booking_requests where id='${ho}'`) === 'confirmed true')
  await shot('05-today-arrived', 'Arrived on the phone-less booking (Undo shown)')
  await click(`[data-testid=booking-row-${ho}-arrived-undo]`)
  await waitFor(`[data-testid=booking-row-${ho}-arrived]`)
  check('undo: checked_in_at cleared', sql(`select checked_in_at is null from booking_requests where id='${ho}'`) === 't')

  // 3. AC-27: Calendar day panel and Table show No phone.
  await goto('/dashboard/bookings?view=calendar', `[data-testid=booking-row-${ho}]`)
  check('calendar day panel: the row shows "No phone"', (await text(`[data-testid=booking-row-${ho}]`)).includes(NO_PHONE))
  await shot('06-calendar-no-phone', 'Calendar day panel row: No phone')
  await focusShot('06b-calendar-row-focus', `[data-testid=booking-row-${ho}]`, 'Calendar day panel row: No phone')
  await goto('/dashboard/bookings?view=table', `[data-testid=booking-row-${ho}]`)
  check('table: the row shows "No phone", no tel: link', (await text(`[data-testid=booking-row-${ho}]`)).includes(NO_PHONE) && !(await evaluate(`!!document.querySelector('[data-testid="booking-row-${ho}"] a[href^="tel:"]')`)))
  await shot('07-table-no-phone', 'Table row: No phone')
  await focusShot('07b-table-row-focus', `[data-testid=booking-row-${ho}]`, 'Table row / card: No phone')

  // 4. AC-28: edit to add a phone (an existing member's): member linked, Notify available; no slot change → no message.
  await openMenu(ho, 'edit')
  await waitFor('[data-testid=booking-form-phone]')
  ns = await notifyState()
  check('edit (no phone yet): Notify disabled with hint', ns.disabled && !ns.checked && ns.hint.includes(HINT), JSON.stringify(ns))
  await type('[data-testid=booking-form-phone]', '+852 2345 6789')
  await waitFor('[data-testid=booking-form-member]')
  ns = await notifyState()
  check('edit add phone: member line shown, Notify available and ticked', ns.checked && !ns.disabled, JSON.stringify(ns))
  await shot('08-form-add-phone', 'Edit: phone added, member found, Notify available')
  const beforeAdd = logLines().length
  await click('[data-testid=booking-form-save]')
  await waitFor('[data-testid=booking-toast]')
  check('edit add phone: phone stored, member linked, notify true', /^\+85223456789\|[0-9a-f-]{36}\|t\|confirmed\|staff$/.test(rowOf('Walk-in Ho')), rowOf('Walk-in Ho'))
  await sleep(1500)
  check('edit add phone: no message (no date/time/party change, AC-6 rule)', sendsSince(beforeAdd).length === 0, String(sendsSince(beforeAdd).length))

  // 5. AC-28 / R20: clear the phone of a staff booking (Mr Chan): member removed, Notify off, no message.
  const chan = idOf('Mr Chan')
  await openMenu(chan, 'edit')
  await waitFor('[data-testid=booking-form-phone]')
  check('edit staff booking: phone label optional', (await phoneLabel()) === OPTIONAL, await phoneLabel())
  await type('[data-testid=booking-form-phone]', '')
  ns = await notifyState()
  check('edit clear phone: Notify unticked + disabled + hint', !ns.checked && ns.disabled && ns.hint.includes(HINT), JSON.stringify(ns))
  await shot('09-form-clear-phone', 'Edit a staff booking: phone cleared, Notify off')
  const beforeClear = logLines().length
  await click('[data-testid=booking-form-save]')
  await waitFor('[data-testid=booking-toast]')
  check('edit clear phone: phone NULL, member NULL, notify false', rowOf('Mr Chan') === 'NULL|NULL|f|confirmed|staff', rowOf('Mr Chan'))
  await sleep(1500)
  check('edit clear phone: no message', sendsSince(beforeClear).length === 0)

  // 6. R20: a diner-channel booking (Hui Wing, chat) keeps the phone required: 400, field error, row unchanged.
  const hui = idOf('Hui Wing')
  await openMenu(hui, 'edit')
  await waitFor('[data-testid=booking-form-phone]')
  check('edit chat booking: phone label plain (required)', (await phoneLabel()) === PLAIN, await phoneLabel())
  await type('[data-testid=booking-form-phone]', '')
  await click('[data-testid=booking-form-save]')
  await sleep(1500)
  const fieldError = await evaluate(`(document.querySelector('label[for=booking-form-phone]')?.parentElement?.querySelector('[role=alert]')?.innerText ?? '').trim()`)
  check('edit chat booking clear phone: refused with a field error on Phone', fieldError.length > 0, fieldError)
  check('edit chat booking clear phone: row unchanged', rowOf('Hui Wing') === '+85297770001|NULL|t|confirmed|chat', rowOf('Hui Wing'))
  await shot('10-clear-chat-refused', 'Diner-channel booking: clearing the phone is refused')
  await focusShot('10b-clear-chat-error-focus', '[data-testid=booking-form-phone]', 'Phone field error on a diner-channel booking')
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await sleep(600)

  // 7. R19: cancel the now phone-less Mr Chan: Notify disabled in the dialog, nothing sent.
  await openMenu(chan, 'cancel')
  await waitFor('[data-testid=booking-cancel-confirm]')
  ns = await notifyState('[data-testid=booking-cancel-notify]')
  check('cancel dialog (no phone): Notify unticked + disabled + hint; diner line says No phone',
    !ns.checked && ns.disabled && ns.hint.includes(HINT) && (await text('[data-testid=booking-cancel-dialog]')).includes(NO_PHONE), JSON.stringify(ns))
  await shot('11-cancel-no-phone', 'Cancel dialog for a booking without a phone')
  await focusShot('11b-cancel-notify-focus', '[data-testid=booking-cancel-notify]', 'Cancel dialog: Notify off + disabled')
  const beforeCancel = logLines().length
  await click('[data-testid=booking-cancel-confirm]')
  await waitFor('[data-testid=booking-toast]')
  check('cancel: status cancelled by staff', sql(`select status || ' ' || cancelled_by from booking_requests where id='${chan}'`) === 'cancelled staff')
  await sleep(1500)
  check('cancel: no message', sendsSince(beforeCancel).length === 0)

  // 8. The whole run: zero sends, none addressed to an empty number.
  const all = sendsSince(start)
  check('run: fake Kapso logged zero message sends for the phone-less bookings', all.length === 0, JSON.stringify(all.map((s) => s.body?.to)))
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
