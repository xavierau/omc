// Probe: after a function-call round trip, can the next request omit `tools`? Also thinkingLevel low accepted?
const key = process.env.GEMINI_API_KEY
const model = process.argv[2] || 'gemini-3.1-flash-lite'
const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
const tools = [{ functionDeclarations: [{ name: 'list_rewards', description: 'List the cafe rewards. No arguments.', parameters: { type: 'object', properties: {} } }] }]
const post = async (body) => {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body) })
  const j = await r.json()
  return { status: r.status, j }
}
const gen = { temperature: 0.3, maxOutputTokens: 400, thinkingConfig: { thinkingLevel: 'low' } }
const contents = [{ role: 'user', parts: [{ text: 'What rewards does the cafe have? Use the tool.' }] }]
const a = await post({ systemInstruction: { parts: [{ text: 'You are a cafe assistant.' }] }, contents, tools, generationConfig: gen })
console.log('call1', a.status, JSON.stringify(a.j.candidates?.[0]?.content?.parts?.map(p => Object.keys(p))), a.j.candidates?.[0]?.finishReason, a.j.error?.message)
const parts = a.j.candidates?.[0]?.content?.parts ?? []
const fc = parts.find(p => p.functionCall)
if (!fc) process.exit(0)
contents.push({ role: 'model', parts })
contents.push({ role: 'user', parts: [{ functionResponse: { ...(fc.functionCall.id ? { id: fc.functionCall.id } : {}), name: fc.functionCall.name, response: { rewards: [{ name: 'Free coffee', pointsCost: 100 }] } } }] })
const b = await post({ systemInstruction: { parts: [{ text: 'You are a cafe assistant.' }] }, contents, generationConfig: gen })
console.log('call2-no-tools', b.status, b.j.candidates?.[0]?.finishReason, JSON.stringify(b.j.candidates?.[0]?.content?.parts?.map(p => p.text ? 'text' : Object.keys(p))), b.j.error?.message)
