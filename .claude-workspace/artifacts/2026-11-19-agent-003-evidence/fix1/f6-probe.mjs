// AGENT-003 F6 live probe: tool step on model A, follow-up on model B. Fake data only. Prints statuses, never the key.
const key = process.env.GEMINI_API_KEY
if (!key) { console.log('no key'); process.exit(1) }
const [A, ...Bs] = process.argv.slice(2)
const url = (m) => `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`
const tools = [{ functionDeclarations: [{ name: 'list_rewards', description: "List the restaurant's rewards. Takes no arguments.", parameters: { type: 'object', properties: {} } }] }]
const gen = { temperature: 0.3, maxOutputTokens: 1024, thinkingConfig: { thinkingLevel: 'low' } }
const sys = { parts: [{ text: 'You are a restaurant assistant. Always call list_rewards before answering any rewards question.' }] }
async function once(model, contents) {
  try {
    const res = await fetch(url(model), { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify({ systemInstruction: sys, contents, tools, generationConfig: gen }) })
    const body = await res.json().catch(() => null)
    return { status: res.status, body }
  } catch (e) { return { status: 'neterr', body: null } }
}
// Retries only 503/429/network errors (overload), never a 400: a 400 is the answer we are looking for.
async function call(model, contents) {
  let r
  for (let i = 0; i < 6; i++) {
    r = await once(model, contents)
    if (r.status !== 503 && r.status !== 429 && r.status !== 'neterr') break
    console.log(JSON.stringify({ retry: i + 1, model, status: r.status }))
    await new Promise((s) => setTimeout(s, 2000))
  }
  return r
}
const user = { role: 'user', parts: [{ text: 'What rewards do you have? (test cafe, fake data)' }] }
const a = await call(A, [user])
const parts = a.body?.candidates?.[0]?.content?.parts ?? []
const fc = parts.filter((p) => p.functionCall)
console.log(JSON.stringify({ step: 'A', model: A, status: a.status, functionCalls: fc.length, withSignature: parts.filter((p) => p.thoughtSignature).length, partKeys: parts.map((p) => Object.keys(p)) }))
if (!fc.length) process.exit(2)
const responses = { role: 'user', parts: fc.map((p) => ({ functionResponse: { ...(p.functionCall.id ? { id: p.functionCall.id } : {}), name: p.functionCall.name, response: { rewards: [{ name: 'Free coffee', pointsCost: 100 }] } } })) }
const strip = (ps) => ps.map(({ thoughtSignature, ...rest }) => rest)
const dummy = (ps) => ps.map(({ thoughtSignature, ...rest }) => (rest.functionCall ? { ...rest, thoughtSignature: 'skip_thought_signature_validator' } : rest))
const pick = (v) => (v === 'verbatim' ? parts : v === 'stripped' ? strip(parts) : dummy(parts))
for (const B of Bs) {
  for (const variant of ['verbatim', 'stripped', 'dummy']) {
    const modelTurn = { role: 'model', parts: pick(variant) }
    const b = await call(B, [user, modelTurn, responses])
    const text = (b.body?.candidates?.[0]?.content?.parts ?? []).filter((p) => typeof p.text === 'string' && !p.thought).map((p) => p.text).join('')
    console.log(JSON.stringify({ step: 'B', model: B, variant, status: b.status, finishReason: b.body?.candidates?.[0]?.finishReason ?? null, textChars: text.length, error: b.status !== 200 ? (b.body?.error?.message ?? '').slice(0, 200) : undefined }))
  }
}
// Control: same model A follow-up verbatim and stripped.
for (const variant of ['verbatim', 'stripped', 'dummy']) {
  const modelTurn = { role: 'model', parts: pick(variant) }
  const b = await call(A, [user, modelTurn, responses])
  console.log(JSON.stringify({ step: 'A-control', model: A, variant, status: b.status, error: b.status !== 200 ? (b.body?.error?.message ?? '').slice(0, 200) : undefined }))
}
