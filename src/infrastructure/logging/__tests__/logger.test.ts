import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import { createWebhookLogger, maskPhone } from '../logger'

const TEST_LOG_DIR = path.join(__dirname, '..', '..', '..', '..', 'logs-test')

describe('createWebhookLogger', () => {
  beforeEach(() => {
    if (fs.existsSync(TEST_LOG_DIR)) {
      fs.rmSync(TEST_LOG_DIR, { recursive: true })
    }
  })

  afterEach(() => {
    if (fs.existsSync(TEST_LOG_DIR)) {
      fs.rmSync(TEST_LOG_DIR, { recursive: true })
    }
  })

  it('creates log directory if missing', () => {
    const log = createWebhookLogger('test-req-1', TEST_LOG_DIR)
    log('info', 'test.event', { key: 'value' })

    expect(fs.existsSync(TEST_LOG_DIR)).toBe(true)
  })

  it('writes JSON line with required fields', () => {
    const log = createWebhookLogger('req-123', TEST_LOG_DIR)
    log('info', 'webhook.received', { size: 42 })

    const files = fs.readdirSync(TEST_LOG_DIR)
    expect(files).toHaveLength(1)
    expect(files[0]).toMatch(/^webhook-\d{4}-\d{2}-\d{2}\.log$/)

    const content = fs.readFileSync(
      path.join(TEST_LOG_DIR, files[0]),
      'utf-8'
    )
    const entry = JSON.parse(content.trim())

    expect(entry.timestamp).toBeDefined()
    expect(entry.level).toBe('info')
    expect(entry.event).toBe('webhook.received')
    expect(entry.data).toEqual({ size: 42 })
    expect(entry.requestId).toBe('req-123')
  })

  it('appends multiple entries to same file', () => {
    const log = createWebhookLogger('req-456', TEST_LOG_DIR)
    log('info', 'first', {})
    log('warn', 'second', {})
    log('error', 'third', { err: 'boom' })

    const files = fs.readdirSync(TEST_LOG_DIR)
    const content = fs.readFileSync(
      path.join(TEST_LOG_DIR, files[0]),
      'utf-8'
    )
    const lines = content.trim().split('\n')

    expect(lines).toHaveLength(3)
    expect(JSON.parse(lines[0]).level).toBe('info')
    expect(JSON.parse(lines[1]).level).toBe('warn')
    expect(JSON.parse(lines[2]).level).toBe('error')
  })
})

describe('maskPhone', () => {
  it('masks phone number keeping last 4 digits', () => {
    expect(maskPhone('85291234567')).toBe('***4567')
  })

  it('handles short numbers', () => {
    expect(maskPhone('1234')).toBe('***1234')
  })

  it('handles undefined', () => {
    expect(maskPhone(undefined)).toBe('***')
  })
})
