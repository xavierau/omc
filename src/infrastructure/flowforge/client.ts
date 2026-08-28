import { WhatsAppClient } from '@kapso/whatsapp-cloud-api'

export interface FlowForgeResult {
  job_id: string
  status: string
  data?: Record<string, unknown>
}

const EXTRACTION_SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    total: { type: 'number', description: 'Final total amount paid including tax and service charge' },
    currency: { type: 'string', description: 'Currency code e.g. HKD, USD' },
    items: {
      type: 'array',
      description: 'Line items',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          price: { type: 'number' },
        },
        required: ['name', 'price'],
      },
    },
    receipt_number: { type: 'string', description: 'Receipt number, invoice number, or transaction ID printed on the receipt. Return empty string if not found.' },
    merchant_name: { type: 'string', description: 'Restaurant or merchant name. Include both Chinese and English if present. Use the English transliteration to cross-check the Chinese characters — e.g. if English says LO CHIU, the Chinese surname should be 趙 not 道.' },
    tamper_assessment: {
      type: 'object',
      description: 'Assess if the receipt image shows signs of digital manipulation, editing, text overlay, inconsistent fonts, or tampering',
      properties: {
        is_suspicious: { type: 'boolean', description: 'true if signs of editing or manipulation are detected' },
        reasons: { type: 'array', items: { type: 'string' }, description: 'List of suspicious indicators found' },
      },
      required: ['is_suspicious', 'reasons'],
    },
  },
  required: ['total', 'currency', 'items'],
})

export async function submitReceiptExtraction(params: {
  imageUrl: string
  imageId?: string
  phoneNumberId?: string
  callbackUrl: string
}): Promise<string> {
  const { apiUrl, apiToken } = getConfig()
  const imageBuffer = await fetchImageBuffer(params)
  const formData = buildFormData(imageBuffer, params.callbackUrl)

  const response = await fetch(`${apiUrl}/api/v1/jobs/extract`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiToken}` },
    body: formData,
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`FlowForge submit failed (${response.status}): ${text}`)
  }

  const json = await response.json()
  console.log('[FlowForge] submit response:', JSON.stringify(json))
  const jobId = json.job_id ?? json.extraction_job_id ?? json.data?.job_id ?? json.data?.extraction_job_id
  if (!jobId) throw new Error(`FlowForge response missing job_id: ${JSON.stringify(json)}`)
  return jobId
}

export async function getJobResult(jobId: string): Promise<FlowForgeResult> {
  const { apiUrl, apiToken } = getConfig()

  const response = await fetch(`${apiUrl}/api/v1/jobs/${jobId}/result`, {
    headers: { Authorization: `Bearer ${apiToken}` },
  })

  if (!response.ok) {
    throw new Error(`FlowForge getJob failed (${response.status})`)
  }

  return response.json()
}

function getConfig() {
  const apiUrl = process.env.FLOWFORGE_API_URL
  const apiToken = process.env.FLOWFORGE_API_TOKEN
  if (!apiUrl || !apiToken) {
    throw new Error('FLOWFORGE_API_URL and FLOWFORGE_API_TOKEN required')
  }
  return { apiUrl, apiToken }
}

function getKapsoClient(): WhatsAppClient {
  const kapsoApiKey = process.env.KAPSO_API_KEY
  if (!kapsoApiKey) throw new Error('KAPSO_API_KEY required to download WhatsApp media')
  return new WhatsAppClient({ kapsoApiKey, baseUrl: 'https://api.kapso.ai/meta/whatsapp' })
}

async function fetchImageBuffer(params: {
  imageUrl: string
  imageId?: string
  phoneNumberId?: string
}): Promise<Buffer> {
  const client = getKapsoClient()

  // Prefer media.download() with mediaId — handles auth automatically
  if (params.imageId) {
    const arrayBuffer = await client.media.download({
      mediaId: params.imageId,
      phoneNumberId: params.phoneNumberId,
    }) as ArrayBuffer
    return Buffer.from(arrayBuffer)
  }

  // Fallback: fetch URL with Kapso auth headers
  const response = await client.fetch(params.imageUrl)
  if (!response.ok) {
    throw new Error(`Failed to fetch image (${response.status})`)
  }
  const arrayBuffer = await response.arrayBuffer()
  return Buffer.from(arrayBuffer)
}

function buildFormData(imageBuffer: Buffer, callbackUrl: string): FormData {
  const formData = new FormData()
  const uint8 = new Uint8Array(imageBuffer)
  const blob = new Blob([uint8], { type: 'image/jpeg' })
  formData.append('file', blob, 'receipt.jpg')
  formData.append('extraction_schema', EXTRACTION_SCHEMA)
  formData.append('extraction_mode', 'vllm')
  formData.append('callback_url', callbackUrl)
  formData.append('source', 'api')
  return formData
}
