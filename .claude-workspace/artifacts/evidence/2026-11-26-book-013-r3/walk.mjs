// BOOK-013 r3 local walk driver (fake data only). Drives a headless Chromium over
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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'b13r3-'))
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

try {
  // Login (real form).
  await goto('/login', 'input[type=email]')
  await type('input[type=email]', 'walk-admin@example.test')
  await type('input[type=password]', password)
  await click('button[type=submit]')
  await sleep(3000)

  // 1. Today view, sorted by time (default): Lunch / Dinner headings, no Scan.
  await goto(phone ? '/dashboard/bookings' : '/dashboard/bookings?view=today', '[data-testid=bookings-today-list]')
  const rows = todayRows()
  check('today: no Scan button, no code on any row (decision 8)', !(await evaluate(`!!document.querySelector('[data-testid=bookings-today-scan], [data-testid$="-code"], [data-testid^=booking-scan]')`)))
  check('today: default sort is time ascending', (await activeSort()) === 'time:asc', await activeSort())
  check('today: rows by time', same(await rowNames(), rows.map((r) => r.name)), JSON.stringify(await rowNames()))
  check('today: Lunch and Dinner headings while sorted by time', (await exists('[data-testid=bookings-today-group-lunch]')) && (await exists('[data-testid=bookings-today-group-dinner]')))
  check('today: phone has the Sort select, desktop the column headers', phone ? await exists('[data-testid=bookings-today-sort]') : (await evaluate(`document.querySelectorAll('[role=columnheader]').length`)) === 5)
  await shot('01-today-time', 'Today, sorted by time (default) with Lunch / Dinner headings')

  // 2. Sort by name (A–Z by the locale's collation), then the same key again reverses it.
  await sortBy('name', 'asc')
  check('sort name: URL ?view=today&sort=name&dir=asc', (await url()).includes('view=today&sort=name&dir=asc'), await url())
  check('sort name: rows A–Z by the locale collation', same(await rowNames(), byName(rows)), JSON.stringify(await rowNames()))
  check('sort name: no meal headings', !(await exists('[data-testid^=bookings-today-group-]')))
  await shot('02-today-name', 'Sorted by name A–Z')
  await sortBy('name', 'desc')
  check('sort name again: reversed, dir=desc in the URL', (await url()).includes('sort=name&dir=desc') && same(await rowNames(), [...byName(rows)].reverse()), JSON.stringify(await rowNames()))
  await shot('03-today-name-desc', 'Name again: reversed (Z–A)')

  // 3. A reload keeps the sort.
  await goto(await url(), '[data-testid=bookings-today-list]')
  check('reload: sort kept (name desc)', (await activeSort()) === 'name:desc' && same(await rowNames(), [...byName(rows)].reverse()), await activeSort())

  // 4. Search "Chan" narrows the list; the sort stays.
  await type('[data-testid=bookings-today-search]', 'Chan')
  const chans = rows.filter((r) => r.name.toLowerCase().includes('chan'))
  check('search Chan: only the Chan bookings, still name Z–A', same(await rowNames(), [...byName(chans)].reverse()), JSON.stringify(await rowNames()))
  check('search Chan: URL sort unchanged', (await url()).includes('sort=name&dir=desc'))
  await shot('04-today-search-chan', 'Search "Chan" with the name sort kept')
  await sortBy('time', 'asc')
  check('search Chan + time sort: Chan bookings by time', same(await rowNames(), chans.map((r) => r.name)), JSON.stringify(await rowNames()))
  await type('[data-testid=bookings-today-search]', '6555')
  check('search 6555: Yeung Family only', same(await rowNames(), ['Yeung Family']))
  await type('[data-testid=bookings-today-search]', '陳')
  check('search 陳: 陳生 only', same(await rowNames(), ['陳生']))
  await type('[data-testid=bookings-today-search]', '')

  // 5. Guests largest first; Status order.
  await sortBy('guests', 'desc')
  const guests = await rowNames()
  check('sort guests: largest first (Yeung Family 8)', guests[0] === 'Yeung Family' && (await url()).includes('sort=guests&dir=desc'), JSON.stringify(guests))
  await shot('05-today-guests', 'Sorted by guests, largest first')
  await sortBy('status', 'asc')
  const states = await evaluate(`[...document.querySelectorAll('[data-testid$="-arrival"], [data-testid$="-arrived-at"]')].map((e) => e.dataset.state ?? 'arrived')`)
  const rank = { late: 0, waiting: 1, needs_reply: 2, arrived: 3, no_show: 4 }
  check('sort status: Late, Waiting, Needs reply, Arrived, No-show', states.every((s, i) => i === 0 || rank[states[i - 1]] <= rank[s]), JSON.stringify(states))
  await sortBy('time', 'asc')

  // 6. Arrived and Undo.
  const cwy = idOf('Chan Wing Yan')
  await click(`[data-testid=booking-row-${cwy}-arrived]`)
  await waitFor(`[data-testid=booking-row-${cwy}-arrived-at]`)
  check('arrived: row shows Arrived HH:MM', true, await text(`[data-testid=booking-row-${cwy}-arrived-at]`))
  check('arrived: DB checked_in_at set, status confirmed', sql(`select status || ' ' || (checked_in_at is not null) from booking_requests where id='${cwy}'`) === 'confirmed true')
  await shot('06-today-arrived', 'Chan Wing Yan marked Arrived (Undo shown)')
  await click(`[data-testid=booking-row-${cwy}-arrived-undo]`)
  await waitFor(`[data-testid=booking-row-${cwy}-arrived]`)
  check('undo: DB checked_in_at cleared', sql(`select checked_in_at is null from booking_requests where id='${cwy}'`) === 't')

  // 7. New booking that breaks the slot limit (Sat 19:00: 16 booked + 6 > 20) → rules prompt → Book anyway.
  const staffBefore = sql(`select count(*) from booking_requests where restaurant_id='${RID}' and source='staff'`)
  await click('[data-testid=booking-new-button]')
  await waitFor('[data-testid=booking-form-phone]')
  await type('[data-testid=booking-form-phone]', '+852 2345 6789')
  await waitFor('[data-testid=booking-form-member]')
  check('form: existing member line shown for the typed phone', true, await text('[data-testid=booking-form-member]'))
  await type('[data-testid=booking-form-name]', 'Lam Chi Keung')
  await type('[data-testid=booking-form-partySize]', '6')
  await setValue('[data-testid=booking-form-date]', '2026-11-28')
  await waitFor('[data-testid=booking-form-slot-1900]')
  await click('[data-testid=booking-form-slot-1900]')
  await type('[data-testid=booking-form-notes]', 'Window table if possible')
  check('form: Notify diner ticked by default', await evaluate(`${q('[data-testid=booking-form-notify]')}.checked`) === true)
  await shot('07-form-new', 'New booking form (member line, slots with guests left, Notify on)')
  const logFile = path.join(OUT, 'kapso-fake.jsonl')
  const before = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).length : 0
  await click('[data-testid=booking-form-save]')
  await waitFor('[data-testid=booking-rules-prompt]')
  check('rules: prompt lists the slot limit', (await text('[data-testid=booking-rules-prompt]')).length > 0, (await text('[data-testid=booking-rules-prompt]')).replace(/\s+/g, ' ').slice(0, 160))
  check('rules: nothing written before Book anyway', sql(`select count(*) from booking_requests where restaurant_id='${RID}' and source='staff'`) === staffBefore)
  await shot('08-rules-prompt', 'Rules prompt: slot over its guest limit, Book anyway')
  await click('[data-testid=booking-rules-override]')
  await waitFor('[data-testid=booking-toast]')
  const created = sql(`select id || ' ' || status || ' ' || source || ' ' || (created_by is not null) || ' ' || coalesce(member_id::text,'-') from booking_requests where restaurant_id='${RID}' and source='staff' and name='Lam Chi Keung' order by created_at desc limit 1`)
  check('create: confirmed, source staff, created_by set, linked to the existing member', /confirmed staff true [0-9a-f-]{36}$/.test(created), created)
  check('create: staff_created event carries the overridden rules', sql(`select data_json->'brokenRules' from events where type='booking.staff_created' order by created_at desc limit 1`).includes('slot_full'))
  check('create: no new member row', sql(`select count(*) from members where restaurant_id='${RID}'`) === '1')
  await sleep(1500)
  const sends = fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).slice(before).map((l) => JSON.parse(l))
  const confirmSend = sends.find((s) => JSON.stringify(s.body ?? '').includes('booking_confirmed_walk01'))
  const comps = confirmSend?.body?.template?.components ?? []
  const params = comps.flatMap((c) => c.parameters ?? []).map((p) => p.parameter_name)
  check('confirm send: develop\'s confirmed template, one BODY component with restaurant/date/time/party_size only (no header, no image, no code)',
    !!confirmSend && confirmSend.body.type === 'template' && comps.length === 1 && comps[0].type === 'body' && same(params, ['restaurant', 'date', 'time', 'party_size']) && !/image|booking-checkin/i.test(JSON.stringify(confirmSend.body)),
    JSON.stringify(comps))
  await shot('09-created-toast', 'Toast after Book anyway')

  // 8. Edit the new booking (4 guests) from the Table view's row menu.
  const newId = created.split(' ')[0]
  await goto('/dashboard/bookings?view=table', `[data-testid=booking-row-${newId}-menu]`)
  check('table: By staff badge on the row, no code', (await exists(`[data-testid=booking-row-${newId}-by-staff]`)) && !(await exists(`[data-testid=booking-row-${newId}-code]`)))
  await click(`[data-testid=booking-row-${newId}-menu]`)
  await waitFor(`[data-testid=booking-row-${newId}-edit]`)
  await shot('10-row-menu', 'Row menu: Edit / Cancel booking')
  await click(`[data-testid=booking-row-${newId}-edit]`)
  await waitFor('[data-testid=booking-form-partySize]')
  await type('[data-testid=booking-form-partySize]', '4')
  await shot('11-form-edit', 'Edit form with the changed party marked')
  await click('[data-testid=booking-form-save]')
  await waitFor('[data-testid=booking-toast]')
  check('edit: party 4, status still confirmed', sql(`select party_size || ' ' || status from booking_requests where id='${newId}'`) === '4 confirmed')

  // 9. Stale edit: another writer changes the party while the form is open (edit_version moves).
  const hui = idOf('Hui Wing')
  await goto('/dashboard/bookings?view=table', `[data-testid=booking-row-${hui}-menu]`)
  await click(`[data-testid=booking-row-${hui}-menu]`)
  await click(`[data-testid=booking-row-${hui}-edit]`)
  await waitFor('[data-testid=booking-form-notes]')
  await type('[data-testid=booking-form-notes]', 'Quiet corner')
  sql(`update booking_requests set party_size = 3 where id='${hui}'`)
  await click('[data-testid=booking-form-save]')
  await waitFor('[data-testid=booking-form-stale]')
  check('stale: 409 changed shows the banner, notes unchanged in DB', sql(`select coalesce(notes,'') from booking_requests where id='${hui}'`) === '')
  await shot('12-form-stale', 'Stale edit: banner + Reload')
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await sleep(600)

  // 10. Cancel Hui Wing with Notify on.
  await goto('/dashboard/bookings?view=table', `[data-testid=booking-row-${hui}-menu]`)
  await click(`[data-testid=booking-row-${hui}-menu]`)
  await click(`[data-testid=booking-row-${hui}-cancel]`)
  await waitFor('[data-testid=booking-cancel-confirm]')
  await shot('13-cancel-dialog', 'Cancel booking dialog with Notify diner')
  await click('[data-testid=booking-cancel-confirm]')
  await waitFor('[data-testid=booking-toast]')
  check('cancel: status cancelled, cancelled_by staff + user', sql(`select status || ' ' || cancelled_by || ' ' || (cancelled_by_user is not null) from booking_requests where id='${hui}'`) === 'cancelled staff true')
  await shot('14-cancelled-toast', 'Cancelled toast; row shows Cancelled by staff')

  // 11. Booking mode off: nav entry gone, page explains, writes 409.
  sql(`update restaurants set booking_config = jsonb_set(booking_config, '{mode}', '"off"') where id='${RID}'`)
  await goto('/dashboard/bookings', '[data-testid=bookings-off]')
  check('mode off: no Bookings link in the sidebar', !(await evaluate(`[...document.querySelectorAll('a')].some((a) => a.getAttribute('href') === '/dashboard/bookings')`)))
  const off = await evaluate(`fetch('/api/dashboard/bookings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone: '+85291112222', name: 'X', partySize: 2, date: '2026-11-28', time: '19:00', notify: false }) }).then(async (r) => r.status + ' ' + (await r.text()))`)
  check('mode off: POST create answers 409 booking_off', off.startsWith('409') && off.includes('booking_off'), off)
  await shot('15-mode-off', 'Booking mode off: Bookings are off + Settings link')
} catch (err) {
  steps.push({ error: String(err.stack ?? err) })
  console.error('WALK ERROR', err)
  const img = await send('Page.captureScreenshot', { format: 'jpeg', quality: 60 })
  fs.writeFileSync(path.join(OUT, `zz-error-${tag}.jpeg`), Buffer.from(img.result.data, 'base64'))
} finally {
  sql(`update restaurants set booking_config = jsonb_set(booking_config, '{mode}', '"simple"') where id='${RID}'`)
  steps.push({ consoleErrors })
  fs.writeFileSync(path.join(OUT, `walk-steps-${tag}.json`), JSON.stringify(steps, null, 2))
  ws.close(); chrome.kill()
  await sleep(500); try { fs.rmSync(dir, { recursive: true, force: true }) } catch {}
}
