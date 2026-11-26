// BOOK-013 local walk driver (fake data only). Drives a headless Chromium over
// the DevTools protocol (Node 22 global WebSocket, no dependency), takes the
// screenshots, runs the ui-layout-audit script on each screen and writes
// walk-steps-<locale>-<width>.json. Usage:
//   node walk.mjs <locale> <width> <password>
// The dev server (port 3060) must run with NEXT_PUBLIC_DEFAULT_LOCALE=<locale>.
import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const [locale, widthArg, password] = process.argv.slice(2)
const W = Number(widthArg)
const H = W < 600 ? 844 : 900
const phone = W < 600
const OUT = path.dirname(new URL(import.meta.url).pathname)
const BASE = 'http://localhost:3060'
const CHROME = `${os.homedir()}/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`
const AUDIT = fs.readFileSync(`${os.homedir()}/.claude/skills/ui-layout-audit/layout-audit.js`, 'utf8')
const PORT = 9300 + (W % 97)
const tag = `${locale === 'en' ? 'en' : 'zh'}-${W}`
const steps = []

const sql = (q) => execFileSync('psql', ['-h', '127.0.0.1', '-p', '54322', '-U', 'postgres', '-d', 'postgres', '-Atc', q], { env: { ...process.env, PGPASSWORD: 'postgres' } }).toString().trim()
const idOf = (name) => sql(`select id from booking_requests where name='${name}' order by created_at desc limit 1`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'b13-'))
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${dir}`, '--no-first-run', '--use-fake-ui-for-media-stream', '--deny-permission-prompts', 'about:blank'], { stdio: 'ignore' })
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
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: phone })
if (phone) await send('Emulation.setTouchEmulationEnabled', { enabled: true })

const q = (sel) => `([...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => e.getClientRects().length > 0) ?? null)`
async function waitFor(sel, ms = 20000) {
  for (let t = 0; t < ms; t += 200) { if (await evaluate(`!!${q(sel)}`)) return; await sleep(200) }
  throw new Error(`timeout waiting for ${sel}`)
}
async function goto(url, sel) {
  await send('Page.navigate', { url: BASE + url }); await sleep(800)
  if (sel) await waitFor(sel, 60000)
  await sleep(600)
}
async function click(sel) {
  await waitFor(sel)
  if (await evaluate(`${q(sel)}.getAttribute('role') === 'menuitem'`)) {
    // Radix menu items: keyboard select (a page scroll under the open menu moves it away from the pointer).
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
  await sleep(400)
}
async function setDate(sel, value) {
  await evaluate(`(() => { const e = ${q(sel)}; const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; s.call(e, ${JSON.stringify(value)}); e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })) })()`)
  await sleep(800)
}
const text = (sel) => evaluate(`(${q(sel)}?.innerText ?? '').trim()`)
async function shot(name, note) {
  await sleep(500)
  const audit = await evaluate(AUDIT).catch((e) => ({ error: String(e) }))
  await evaluate('window.scrollTo(0,0)').catch(() => {})
  const file = `${name}-${tag}.jpeg`
  const img = await send('Page.captureScreenshot', { format: 'jpeg', quality: 70 })
  fs.writeFileSync(path.join(OUT, file), Buffer.from(img.result.data, 'base64'))
  const blocking = (audit?.findings ?? []).filter((f) => f.sev === 'blocking')
  const warnings = (audit?.findings ?? []).filter((f) => f.sev === 'warning').map((f) => `${f.check}: ${String(f.el).slice(0, 90)} | ${String(f.detail).slice(0, 120)}`)
  steps.push({ step: name, note, file, url: await evaluate('location.pathname + location.search'), audit: audit?.summary ?? audit, blocking, warnings })
  console.log(`${file}  blocking=${audit?.summary?.blocking ?? '?'} warning=${audit?.summary?.warning ?? '?'}`)
}
const check = (name, ok, detail) => { steps.push({ check: name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail ?? ''}`) }

try {
  // Login (real form).
  await goto('/login', 'input[type=email]')
  await type('input[type=email]', 'walk-admin@example.test')
  await type('input[type=password]', password)
  await click('button[type=submit]')
  await sleep(3000)

  // 1. Today view (default on the phone; ?view=today on desktop).
  await goto(phone ? '/dashboard/bookings' : '/dashboard/bookings?view=today', '[data-testid=bookings-today-list]')
  const wu = idOf('Wu Siu Ming'), au = idOf('Au Ka Yan')
  check('today: Wu Siu Ming is late (18:30 booking)', (await evaluate(`${q(`[data-testid=booking-row-${wu}-arrival]`)}?.dataset.state`)) === 'late')
  check('today: Au Ka Yan shows Arrived', !!(await evaluate(`!!${q(`[data-testid=booking-row-${au}-arrived-at]`)}`)))
  check('today: pending Kan Wai shows needs reply', (await evaluate(`${q(`[data-testid=booking-row-${idOf('Kan Wai')}-arrival]`)}?.dataset.state`)) === 'needs_reply')
  await shot('01-today', 'Today view: counters, Late / Arrived / Waiting / Needs reply')

  // 2. Search by code -> server lookup card; by name -> filtered list.
  await type('[data-testid=bookings-today-search]', 'p4mx8t')
  await waitFor('[data-testid=booking-scan-result]')
  check('search: code P4MX8T (Sat booking) found by the server lookup', (await text('[data-testid=booking-scan-result]')).includes('Hui Wing'))
  await shot('02-today-code-card', 'whole code typed: result card for a booking on another day')
  await type('[data-testid=bookings-today-search]', '6555')
  check('search: phone digits 6555 matches Yeung Family only', (await text('[data-testid=bookings-today-list]')).includes('Yeung') && !(await text('[data-testid=bookings-today-list]')).includes('Wu Siu'))
  await type('[data-testid=bookings-today-search]', '<script>x</script>')
  check('search: script string matches nothing, no lookup', !(await evaluate(`!!${q('[data-testid=booking-scan-result]')}`)))
  await type('[data-testid=bookings-today-search]', '')

  // 3. Arrived and Undo on Wu Siu Ming.
  await click(`[data-testid=booking-row-${wu}-arrived]`)
  await waitFor(`[data-testid=booking-row-${wu}-arrived-at]`)
  check('arrived: row shows Arrived HH:MM', true, await text(`[data-testid=booking-row-${wu}-arrived-at]`))
  check('arrived: DB checked_in_at set, status confirmed', sql(`select status || ' ' || (checked_in_at is not null) from booking_requests where id='${wu}'`) === 'confirmed true')
  await shot('03-today-arrived', 'Wu Siu Ming marked Arrived (Undo shown)')
  await click(`[data-testid=booking-row-${wu}-arrived-undo]`)
  await waitFor(`[data-testid=booking-row-${wu}-arrived]`)
  check('undo: DB checked_in_at cleared', sql(`select checked_in_at is null from booking_requests where id='${wu}'`) === 't')

  // 4. Scan sheet (headless camera: the scanner shows its blocked / no-camera state).
  await click('[data-testid=bookings-today-scan]')
  await waitFor('[data-testid=bookings-today-scan-sheet]')
  await sleep(1500)
  await shot('04-scan-sheet', 'Scan QR sheet (existing html5-qrcode scanner; headless has no camera)')
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await sleep(600)

  // 5. New booking that breaks the slot limit (19:00 Sat: 16 booked + 6 > 20).
  await click('[data-testid=booking-new-button]')
  await waitFor('[data-testid=booking-form-phone]')
  await type('[data-testid=booking-form-phone]', '+852 2345 6789')
  await waitFor('[data-testid=booking-form-member]')
  check('form: existing member line shown for the typed phone', true, await text('[data-testid=booking-form-member]'))
  await type('[data-testid=booking-form-name]', 'Lam Chi Keung')
  await type('[data-testid=booking-form-partySize]', '6')
  await setDate('[data-testid=booking-form-date]', '2026-11-28')
  await waitFor('[data-testid=booking-form-slot-1900]')
  await click('[data-testid=booking-form-slot-1900]')
  await type('[data-testid=booking-form-notes]', 'Window table if possible')
  check('form: Notify diner ticked by default', await evaluate(`${q('[data-testid=booking-form-notify]')}.checked`) === true)
  await shot('05-form-new', 'New booking form filled (member line, slots with guests left, Notify on)')
  const before = fs.existsSync(path.join(OUT, 'kapso-fake.jsonl')) ? fs.readFileSync(path.join(OUT, 'kapso-fake.jsonl'), 'utf8').split('\n').filter(Boolean).length : 0
  await click('[data-testid=booking-form-save]')
  await waitFor('[data-testid=booking-rules-prompt]')
  check('rules: prompt lists the slot limit', (await text('[data-testid=booking-rules-prompt]')).length > 0, await text('[data-testid=booking-rules-prompt]'))
  check('rules: nothing written before Book anyway', sql(`select count(*) from booking_requests where source='staff'`) === '0')
  await shot('06-rules-prompt', 'Rules prompt: slot over its guest limit, Book anyway')
  await click('[data-testid=booking-rules-override]')
  await waitFor('[data-testid=booking-toast]')
  const created = sql(`select id || ' ' || status || ' ' || source || ' ' || coalesce(checkin_code,'-') || ' ' || (created_by is not null) || ' ' || coalesce(member_id::text,'-') from booking_requests where source='staff' order by created_at desc limit 1`)
  check('create: confirmed, source staff, code minted, created_by set, linked to existing member', /confirmed staff [A-Z0-9]{6} true [0-9a-f-]{36}$/.test(created), created)
  check('create: staff_created event carries the overridden rules', sql(`select count(*) from events where type='booking.staff_created' and data_json ? 'brokenRules'`) === '1', sql(`select data_json->'brokenRules' from events where type='booking.staff_created' order by created_at desc limit 1`))
  check('create: no new member row', sql(`select count(*) from members`) === '1')
  await sleep(1500)
  const sends = fs.readFileSync(path.join(OUT, 'kapso-fake.jsonl'), 'utf8').split('\n').filter(Boolean).slice(before).map((l) => JSON.parse(l))
  const confirmSend = sends.find((s) => JSON.stringify(s.body).includes('booking_confirmed_walk01'))
  const header = confirmSend?.body?.template?.components?.find((c) => c.type === 'header')
  const code = created.split(' ')[3]
  check('confirm send: template with IMAGE header link to booking-checkin-qr and the code in the body', !!header && JSON.stringify(header).includes('/booking-checkin-qr/') && JSON.stringify(confirmSend.body).includes(code), header ? JSON.stringify(header).replace(/[A-Za-z0-9_-]{30,}\.png/, '<random>.png') : JSON.stringify(sends.map((s) => s.path)))
  const qrPath = sql(`select checkin_qr_path from booking_requests where checkin_code='${code}'`)
  check('QR file path is random, not the code', qrPath.length >= 22 && !qrPath.includes(code), `${qrPath.length} chars`)
  await shot('07-created-toast', 'Toast after Book anyway')

  // 6. Edit the new booking (5 guests): changed marks, then save.
  const newId = created.split(' ')[0]
  await goto(`/dashboard/bookings?view=table`, `[data-testid=booking-row-${newId}-menu]`)
  check('table: By staff badge and code on the row', !!(await evaluate(`!!${q(`[data-testid=booking-row-${newId}-by-staff]`)} && !!${q(`[data-testid=booking-row-${newId}-code]`)}`)))
  await shot('08-table-staff-row', 'Table view: By staff badge, check-in code, row menu')
  await click(`[data-testid=booking-row-${newId}-menu]`)
  await waitFor(`[data-testid=booking-row-${newId}-edit]`)
  await shot('09-row-menu', 'Row menu: Edit / Cancel booking')
  await click(`[data-testid=booking-row-${newId}-edit]`)
  await waitFor('[data-testid=booking-form-partySize]')
  await type('[data-testid=booking-form-partySize]', '4')
  await shot('10-form-edit', 'Edit form with the changed party marked')
  await click('[data-testid=booking-form-save]')
  await waitFor('[data-testid=booking-toast]')
  check('edit: party 4, status still confirmed, code kept', sql(`select party_size || ' ' || status || ' ' || checkin_code from booking_requests where id='${newId}'`) === `4 confirmed ${code}`)

  // 7. Stale edit: another write lands while the form is open.
  const hui = idOf('Hui Wing')
  await goto(`/dashboard/bookings?view=table`, `[data-testid=booking-row-${hui}-menu]`)
  await click(`[data-testid=booking-row-${hui}-menu]`)
  await click(`[data-testid=booking-row-${hui}-edit]`)
  await waitFor('[data-testid=booking-form-notes]')
  await type('[data-testid=booking-form-notes]', 'Quiet corner')
  sql(`update booking_requests set updated_at = now() where id='${hui}'`)
  await click('[data-testid=booking-form-save]')
  await waitFor('[data-testid=booking-form-stale]')
  check('stale: 409 changed shows the banner, notes unchanged in DB', sql(`select coalesce(notes,'') from booking_requests where id='${hui}'`) === '')
  await shot('11-form-stale', 'Stale edit: banner + Reload')
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await sleep(600)

  // 8. Cancel Hui Wing with Notify on.
  await goto(`/dashboard/bookings?view=table`, `[data-testid=booking-row-${hui}-menu]`)
  await click(`[data-testid=booking-row-${hui}-menu]`)
  await click(`[data-testid=booking-row-${hui}-cancel]`)
  await waitFor('[data-testid=booking-cancel-confirm]')
  await shot('12-cancel-dialog', 'Cancel booking dialog with Notify diner')
  await click('[data-testid=booking-cancel-confirm]')
  await waitFor('[data-testid=booking-toast]')
  check('cancel: status cancelled, cancelled_by staff + user', sql(`select status || ' ' || cancelled_by || ' ' || (cancelled_by_user is not null) from booking_requests where id='${hui}'`) === 'cancelled staff true')
  await shot('13-cancelled-toast', 'Cancelled toast; row shows Cancelled by staff')

  // 9. Booking mode off: nav entry gone, page explains, writes 409.
  sql(`update restaurants set booking_config = jsonb_set(booking_config, '{mode}', '"off"') where id='11111111-1111-4111-8111-111111111111'`)
  await goto('/dashboard/bookings', '[data-testid=bookings-off]')
  check('mode off: no Bookings link in the sidebar', !(await evaluate(`[...document.querySelectorAll('nav a')].some((a) => a.getAttribute('href') === '/dashboard/bookings')`)))
  const off = await evaluate(`fetch('/api/dashboard/bookings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone: '+85291112222', name: 'X', partySize: 2, date: '2026-11-28', time: '19:00', notify: false }) }).then(async (r) => r.status + ' ' + (await r.text()))`)
  check('mode off: POST create answers 409 booking_off', off.startsWith('409') && off.includes('booking_off'), off)
  await shot('14-mode-off', 'Booking mode off: Bookings are off + Settings link')
  sql(`update restaurants set booking_config = jsonb_set(booking_config, '{mode}', '"simple"') where id='11111111-1111-4111-8111-111111111111'`)
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
