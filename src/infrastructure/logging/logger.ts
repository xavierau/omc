import fs from 'fs'
import path from 'path'

type LogLevel = 'info' | 'warn' | 'error' | 'critical'

interface LogEntry {
  timestamp: string
  level: LogLevel
  event: string
  data: unknown
  requestId: string
}

type WebhookLogger = (
  level: LogLevel,
  event: string,
  data: unknown
) => void

const DEFAULT_LOG_DIR = path.join(process.cwd(), 'logs')

export function createWebhookLogger(
  requestId: string,
  logDir: string = DEFAULT_LOG_DIR
): WebhookLogger {
  return (level, event, data) => {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      event,
      data,
      requestId,
    }
    writeLogEntry(entry, logDir)
  }
}

function writeLogEntry(entry: LogEntry, logDir: string): void {
  try {
    ensureDir(logDir)
    const filename = buildFilename()
    const filepath = path.join(logDir, filename)
    fs.appendFileSync(filepath, JSON.stringify(entry) + '\n')
  } catch {
    // Logging must never crash the app
  }
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function buildFilename(): string {
  const date = new Date().toISOString().slice(0, 10)
  return `webhook-${date}.log`
}

export function maskPhone(phone: string | undefined): string {
  if (!phone) return '***'
  const last4 = phone.slice(-4)
  return `***${last4}`
}
